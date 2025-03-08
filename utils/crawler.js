import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import https from 'https';
import dayjs from 'dayjs';
import sharp from 'sharp';
import xlsx from 'xlsx';

// 파일 시스템 비동기 함수
const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);
const copyFile = promisify(fs.copyFile);

// 이미지 다운로드 함수
async function downloadImage(url, filePath) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`이미지 다운로드 실패 (상태 코드: ${response.statusCode})`));
          return;
        }

        const chunks = [];
        
        response.on('data', (chunk) => chunks.push(chunk));
        
        response.on('end', async () => {
          const buffer = Buffer.concat(chunks);
          fs.writeFile(filePath, buffer, (err) => {
            if (err) reject(err);
            else resolve(filePath);
          });
        });
      })
      .on('error', reject);
  });
}

// 이미지 최적화 처리 함수
async function processImage(imgPath) {
  try {
    // 이미지 로드
    const image = await sharp(imgPath);
    const metadata = await image.metadata();
    
    // 새 캔버스 생성 (1000x1000, 흰색 배경)
    const canvas = sharp({
      create: {
        width: 1000,
        height: 1000,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 }
      }
    });
    
    // 원본 이미지의 가로와 세로 크기
    const { width, height } = metadata;
    
    // 이미지 중앙 위치 계산
    const left = Math.floor((1000 - width) / 2);
    const top = Math.floor((1000 - height) / 2);
    
    // 원본 이미지를 캔버스에 합성
    const compositeImage = await canvas.composite([
      { input: imgPath, left, top }
    ])
    .jpeg({ quality: 90, progressive: true })
    .toBuffer();
    
    // 결과 저장
    await writeFile(imgPath, compositeImage);
    
    // 파일 크기 반환 (KB)
    const stats = fs.statSync(imgPath);
    return stats.size / 1024;
  } catch (error) {
    throw new Error(`이미지 처리 중 오류: ${error.message}`);
  }
}
// 브라우저 설정 함수
async function setupBrowser() {
  return await puppeteer.launch({
    headless: true,
    args: [
      '--window-size=1024,768',
      '--disable-blink-features=AutomationControlled',
      '--disable-gpu', 
      '--disable-extensions',
      '--disable-infobars',
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ],
    defaultViewport: { width: 1024, height: 768 },
  });
}

// 상품 상세 페이지 크롤링 함수
async function crawlProductDetails(url, index = null, total = null, onLog) {
  let browser = null;
  
  try {
    if (index !== null && total !== null) {
      onLog(`\n상품 ${index}/${total} 상세 정보 크롤링 중...`);
    }
    
    browser = await setupBrowser();
    const page = await browser.newPage();
    
    // 자동화 감지 회피
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
    
    // 유저 에이전트 설정
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/98.0.4758.102 Safari/537.36');
    
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    
    // 상품명 추출
    let name = "상품명 없음";
    try {
      name = await page.$eval("h1.ProductDetails-header", el => el.textContent.trim());
    } catch {
      try {
        name = await page.$eval(".kds-Text--l.kds-Text--bold", el => el.textContent.trim());
      } catch {
        // 계속 진행
      }
    }
    
    onLog(`상품명: ${name}`);
    
    // 가격 추출
    let priceNumeric = "";
    try {
      const priceText = await page.$eval("mark.kds-Price-promotional", el => el.textContent.trim());
      // 숫자만 추출 (소수점 포함)
      priceNumeric = priceText.replace(/[^\d.]/g, '');
    } catch {
      // 계속 진행
    }
    
    onLog(`숫자 가격: ${priceNumeric}`);
    
    // 이미지 URL 추출 (최대 3개)
    let images = [];
    
    // 방법 1: 직접 이미지 URL 추출 (xlarge 크기로 변경)
    try {
      const productId = url.split('/').pop().split('?')[0];
      if (productId) {
        const baseUrl = "https://www.kroger.com/product/images/xlarge";
        const imgUrls = [
          `${baseUrl}/front/${productId}`,
          `${baseUrl}/back/${productId}`,
          `${baseUrl}/right/${productId}`
        ];
        images = [...imgUrls];
      }
    } catch {
      // 다음 방법 시도
    }
// 방법 2: 고해상도 이미지 요소 찾기
    if (images.length === 0) {
      try {
        const zoomImgs = await page.$$eval(".iiz__zoom-img", els => 
          els.map(el => el.getAttribute("src")).filter(Boolean).slice(0, 3)
        );
        
        if (zoomImgs.length > 0) {
          images = zoomImgs;
          onLog(`확대 이미지 찾음: ${images[0]}`);
        }
      } catch {
        // 다음 방법 시도
      }
    }
    
    // 방법 3: 일반 이미지 중 xlarge 찾기
    if (images.length === 0) {
      try {
        const xlargeImages = await page.$$eval("img", els => 
          els.map(el => el.getAttribute("src"))
            .filter(src => src && src.includes("xlarge") && 
              (src.includes("kroger.com/product/images") || src.includes("fredmeyer.com/product/images")))
            .slice(0, 3)
        );
        
        if (xlargeImages.length > 0) {
          images = xlargeImages;
        }
      } catch {
        // 다음 방법 시도
      }
    }
    
    // 방법 4: 일반 이미지 찾기 (xlarge가 없는 경우)
    if (images.length === 0) {
      try {
        const productImages = await page.$$eval("img", els => 
          els.map(el => el.getAttribute("src"))
            .filter(src => src && 
              (src.includes("kroger.com/product/images") || src.includes("fredmeyer.com/product/images")))
            .slice(0, 3)
            .map(src => src.includes("large") ? src.replace("large", "xlarge") : src)
        );
        
        if (productImages.length > 0) {
          images = productImages;
        }
      } catch {
        // 계속 진행
      }
    }
    
    // 이미지가 부족한 경우 처리
    if (images.length === 0) {
      onLog("이미지를 찾을 수 없습니다. 더미 이미지를 사용합니다.");
      // 더미 이미지 URL 생성
      const dummyImage = "https://www.fredmeyer.com/product/images/xlarge/dummy";
      images = [dummyImage, dummyImage, dummyImage];
    } else if (images.length > 0) {
      const firstImage = images[0];
      // 2번 이미지가 없으면 1번 이미지 사용
      if (images.length < 2) {
        images.push(firstImage);
        onLog("2번 이미지 없음: 1번 이미지로 대체합니다.");
      }
      // 3번 이미지가 없으면 1번 이미지 사용
      if (images.length < 3) {
        images.push(firstImage);
        onLog("3번 이미지 없음: 1번 이미지로 대체합니다.");
      }
    }
    
    // 결과 반환
    return {
      "상품명": name,
      "숫자 가격": priceNumeric,
      "상품 링크": url,
      "이미지1": images[0] || "이미지 없음",
      "이미지2": images[1] || "이미지 없음",
      "이미지3": images[2] || "이미지 없음"
    };
    
  } catch (error) {
    onLog(`상세 페이지 크롤링 중 오류 발생: ${error.message}`);
    return null;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
// 상품 페이지 크롤링 메인 함수
export async function fredfmeyerCrawl({ 
  url, 
  maxItems = 200, 
  downloadImages = true, 
  productCode = "20250305-W001",
  onLog = () => {},
  onProgress = () => {} 
}) {
  onLog("=== 프레드메이어 상품 크롤링 시작 ===");
  onLog(`대상 URL: ${url}`);
  
  // 결과 디렉토리 생성
  const timestamp = dayjs().format("YYYYMMDD_HHmmss");
  const resultsDir = path.join(process.cwd(), "public", "results");
  const imagesDir = path.join(resultsDir, `images_${timestamp}`);
  
  try {
    // 결과 디렉토리가 없으면 생성
    if (!fs.existsSync(resultsDir)) {
      await mkdir(resultsDir, { recursive: true });
    }
    
    // 이미지 디렉토리 생성
    if (downloadImages && !fs.existsSync(imagesDir)) {
      await mkdir(imagesDir, { recursive: true });
      onLog(`\n새로운 이미지 폴더 생성: ${imagesDir}`);
    }
    
    // URL이 http로 시작하지 않으면 https:// 추가
    if (!url.startsWith('http')) {
      url = 'https://' + url.replace(/^\/+/, '');
    }
    
    // 단일 상품 상세 페이지인 경우
    if (url.includes('/p/')) {
      const product = await crawlProductDetails(url, null, null, onLog);
      if (product) {
        // 판매자 상품코드 기본값 가져오기
        const [datePart, codePrefix] = productCode.split('-');
        
        // 판매자 상품코드 추가
        product["판매자 상품코드"] = productCode;
        
        // 이미지 파일명 설정
        product["이미지파일1"] = product["이미지1"] !== "이미지 없음" ? `${codePrefix}-1.jpg` : "";
        product["이미지파일2"] = product["이미지2"] !== "이미지 없음" ? `${codePrefix}-2.jpg` : "";
        product["이미지파일3"] = product["이미지3"] !== "이미지 없음" ? `${codePrefix}-3.jpg` : "";
        
        if (downloadImages) {
          await downloadProductImages([product], imagesDir, onLog);
        }
        
        const filePath = await saveToExcel([product], resultsDir, timestamp, onLog);
        onLog("\n크롤링이 완료되었습니다.");
        return { filePath, count: 1 };
      }
      return { filePath: null, count: 0 };
    }
    
    // 상품 목록 페이지인 경우 크롤링
    let browser = null;
    const products = [];
    const productLinks = [];
    let currentPage = 1;
try {
      browser = await setupBrowser();
      const page = await browser.newPage();
      
      // 자동화 감지 회피
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      });
      
      // 유저 에이전트 설정
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/98.0.4758.102 Safari/537.36');
      
      // 최대 3페이지까지 크롤링
      while (currentPage <= 3 && productLinks.length < maxItems) {
        let currentUrl = url;
        
        // 페이지 파라미터 추가 (2페이지부터)
        if (currentPage > 1) {
          onLog(`\n${currentPage}페이지로 이동합니다...`);
          
          // URL에 페이지 번호 추가
          const pageRegex = /page=(\d+)/;
          const pageMatch = currentUrl.match(pageRegex);
          
          if (pageMatch) {
            currentUrl = currentUrl.replace(pageRegex, `page=${currentPage}`);
          } else {
            // 페이지 파라미터가 없는 경우 추가
            currentUrl += currentUrl.includes('?') ? `&page=${currentPage}` : `?page=${currentPage}`;
          }
          
          await page.goto(currentUrl, { waitUntil: 'networkidle2', timeout: 30000 });
          await page.waitForTimeout(5000);  // 페이지 로딩 대기
        }
        
        onLog(`\n${currentPage}페이지 크롤링 중...`);
        
        if (currentPage === 1) {
          onLog("\n1. 페이지 로딩 중...");
          await page.goto(currentUrl, { waitUntil: 'networkidle2', timeout: 30000 });
          await page.waitForTimeout(5000);
        }
        
        onLog("2. 페이지 스크롤 중...");
        
        // 여러 번 스크롤하여 더 많은 상품 로드
        let prevHeight = 0;
        const maxScrollAttempts = 15;
        
        for (let scrollAttempt = 0; scrollAttempt < maxScrollAttempts; scrollAttempt++) {
          // 페이지 끝까지 스크롤
          await page.evaluate(() => {
            window.scrollTo(0, document.body.scrollHeight);
          });
          
          await page.waitForTimeout(3000);  // 로딩 대기
          
          // 현재 스크롤 높이 확인
          const currentHeight = await page.evaluate(() => document.body.scrollHeight);
          
          // 현재 상품 카드 수 확인
          const currentCards = await page.$$eval(".ProductCard", els => els.length);
          
          // 스크롤 진행 상황 로깅
          onLog(`  스크롤 ${scrollAttempt+1}/${maxScrollAttempts} 완료 (높이: ${currentHeight}, 상품 수: ${currentCards})`);
          
          // 더 이상 새로운 컨텐츠가 로드되지 않으면 스크롤 중단
          if (currentHeight === prevHeight && scrollAttempt > 0) {
            onLog("  더 이상 새로운 컨텐츠가 로드되지 않습니다. 스크롤 중단");
            break;
          }
          
          // 중간에 한번 더 스크롤 (긴 페이지에서 더 많은 상품 로드)
          if (scrollAttempt % 3 === 2) {
            await page.evaluate(() => {
              window.scrollBy(0, -500);
            });
            await page.waitForTimeout(1000);
            await page.evaluate(() => {
              window.scrollBy(0, 500);
            });
            await page.waitForTimeout(1000);
          }
          
          prevHeight = currentHeight;
        }
onLog("\n3. 상품 카드 찾는 중...");
        
        // 상품 카드 찾기 (여러 선택자 시도)
        let productCards = [];
        
        // 방법 1: ProductCard 클래스로 찾기
        productCards = await page.$$(".ProductCard");
        onLog(`방법 1: ${productCards.length}개의 상품 카드 발견 (ProductCard 클래스)`);
        
        // 방법 2: 상품 링크로 직접 찾기
        if (productCards.length < 5) {
          productCards = await page.$$("a[href*='/p/']");
          onLog(`방법 2: ${productCards.length}개의 상품 카드 발견 (상품 링크)`);
        }
        
        // 방법 3: 일반 상품 컨테이너 찾기
        if (productCards.length < 5) {
          productCards = await page.$$(".kds-Card");
          onLog(`방법 3: ${productCards.length}개의 상품 카드 발견 (kds-Card)`);
        }
        
        onLog(`\n총 ${productCards.length}개의 상품 카드 발견`);
        
        // 상품 링크 목록 수집
        let pageLinks = [];
        
        // 방법 1: 카드에서 링크 추출
        for (const card of productCards) {
          try {
            // 카드 자체가 링크인 경우
            const tagName = await page.evaluate(el => el.tagName.toLowerCase(), card);
            
            if (tagName === 'a') {
              const href = await page.evaluate(el => el.getAttribute('href'), card);
              
              if (href && href.includes('/p/')) {
                let link = href;
                if (!link.startsWith('http')) {
                  link = 'https://www.fredmeyer.com' + link;
                }
                
                if (!pageLinks.includes(link)) {
                  pageLinks.push(link);
                }
              }
            } else {
              // 카드 내부에서 링크 찾기
              const linkElements = await card.$$("a[href*='/p/']");
              for (const linkElem of linkElements) {
                const href = await page.evaluate(el => el.getAttribute('href'), linkElem);
                
                if (href) {
                  let link = href;
                  if (!link.startsWith('http')) {
                    link = 'https://www.fredmeyer.com' + link;
                  }
                  
                  if (!pageLinks.includes(link)) {
                    pageLinks.push(link);
                  }
                }
              }
            }
          } catch (error) {
            // 계속 진행
          }
        }
        
        // 방법 2: 페이지 전체에서 상품 링크 찾기 (백업 방법)
        if (pageLinks.length < 10) {
          onLog("  카드에서 충분한 링크를 찾지 못했습니다. 페이지 전체에서 링크를 찾습니다.");
          try {
            const allLinks = await page.$$("a[href*='/p/']");
            for (const linkElem of allLinks) {
              const href = await page.evaluate(el => el.getAttribute('href'), linkElem);
              
              if (href) {
                let link = href;
                if (!link.startsWith('http')) {
                  link = 'https://www.fredmeyer.com' + link;
                }
                
                if (!pageLinks.includes(link)) {
                  pageLinks.push(link);
                }
              }
            }
          } catch (error) {
            // 계속 진행
          }
        }
        
        onLog(`\n${currentPage}페이지에서 ${pageLinks.length}개의 상품 링크 추출 성공`);
