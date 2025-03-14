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
// 전체 링크 목록에 추가
        productLinks.push(...pageLinks);
        
        // 다음 페이지로 이동
        if (pageLinks.length === 0) {
          onLog("더 이상 상품이 없습니다. 페이지 크롤링을 중단합니다.");
          break;
        }
        
        currentPage += 1;
      }
      
      // 메인 브라우저 종료
      if (browser) {
        await browser.close();
        browser = null;
      }
      
      // 상세 페이지 크롤링
      onLog("\n상세 페이지 크롤링 시작...");
      const totalLinks = productLinks.length;
      
      // 사용자가 지정한 최대 크롤링 개수
      const maxProducts = Math.min(maxItems, totalLinks);
      onLog(`총 ${totalLinks}개 중 ${maxProducts}개 상품 크롤링 예정`);
      
      // 판매자 상품코드 기본값 가져오기
      const baseProductCode = productCode;
      
      // 날짜와 코드 접두사 분리 (예: "20250305-W001" -> "20250305", "W001")
      const codeParts = baseProductCode.split('-');
      const datePart = codeParts[0] || dayjs().format("YYYYMMDD");
      const codePrefix = codeParts[1] || "W001";
      
      // 코드 접두사에서 문자 부분과 숫자 부분 분리 (예: "W001" -> "W", "001")
      const prefixMatch = codePrefix.match(/([A-Za-z]+)(\d+)/);
      let letterPart = "W";
      let startNumber = 1;
      
      if (prefixMatch) {
        letterPart = prefixMatch[1];  // 예: "W"
        startNumber = parseInt(prefixMatch[2], 10);  // 예: "001" -> 1
      }
      
      for (let i = 0; i < Math.min(productLinks.length, maxProducts); i++) {
        const link = productLinks[i];
        
        try {
          const product = await crawlProductDetails(link, i+1, maxProducts, onLog);
          if (product) {
            // 판매자 상품코드 생성 (예: "20250305-W001", "20250305-W002", ...)
            const currentNumber = startNumber + i;
            const formattedNumber = String(currentNumber).padStart(3, '0');  // 숫자를 3자리로 포맷팅 (예: 1 -> "001")
            const productCode = `${datePart}-${letterPart}${formattedNumber}`;
            
            // 판매자 상품코드 추가
            product["판매자 상품코드"] = productCode;
            
            // 이미지 파일명 설정 (예: "W001-1.jpg", "W001-2.jpg", "W001-3.jpg")
            const codeSuffix = `${letterPart}${formattedNumber}`;
            product["이미지파일1"] = product["이미지1"] !== "이미지 없음" ? `${codeSuffix}-1.jpg` : "";
            product["이미지파일2"] = product["이미지2"] !== "이미지 없음" ? `${codeSuffix}-2.jpg` : "";
            product["이미지파일3"] = product["이미지3"] !== "이미지 없음" ? `${codeSuffix}-3.jpg` : "";
            
            products.push(product);
          }
          
          // 진행률 업데이트
          const progress = ((i + 1) / maxProducts) * 100;
          onProgress(progress);
        } catch (error) {
          onLog(`상품 ${i+1} 상세 정보 크롤링 실패: ${error.message}`);
        }
      }
if (products.length > 0) {
        // 이미지 다운로드
        if (downloadImages) {
          await downloadProductImages(products, imagesDir, onLog);
        }
        
        // Excel 저장
        const filePath = await saveToExcel(products, resultsDir, timestamp, onLog);
        onLog(`\n총 ${products.length}개의 상품 정보를 찾았습니다.`);
        return { filePath, count: products.length };
      } else {
        onLog("\n저장할 상품 정보가 없습니다.");
        return { filePath: null, count: 0 };
      }
    } catch (error) {
      onLog(`\n크롤링 중 오류 발생: ${error.message}`);
      onLog(error.stack);
      throw error;
    } finally {
      onLog("\n브라우저 종료 중...");
      if (browser) {
        try {
          await browser.close();
        } catch {
          // 무시
        }
      }
    }
  }
}

// 상품 이미지 다운로드 함수
async function downloadProductImages(products, imagesDir, onLog) {
  onLog("\n이미지 다운로드 시작...");
  
  // 각 상품의 이미지 다운로드
  for (let i = 0; i < products.length; i++) {
    const product = products[i];
    const productNum = i + 1;  // 상품 번호
    
    // 상품코드에서 접미사 부분 추출 (예: W001)
    const codeParts = product["판매자 상품코드"].split('-');
    const codeSuffix = codeParts[1] || `W${String(productNum).padStart(3, '0')}`;
    
    const productName = product["상품명"];
    
    // 상품 번호 추가
    product["번호"] = productNum;
    
    // 파일명으로 사용할 수 없는 문자 제거
    const safeName = productName.replace(/[\\/*?:"<>|]/g, "").substring(0, 50);  // 이름 길이 제한
    
    onLog(`\n상품 ${productNum}/${products.length} 이미지 다운로드 중: ${safeName}`);
    
    // 각 이미지 다운로드
    let firstImagePath = null;  // 첫 번째 이미지 경로 저장용
    
    // 먼저 1번 이미지 다운로드 시도
    const img1Url = product["이미지1"];
    if (img1Url && img1Url !== "이미지 없음") {
      try {
        // 이미지 파일명 사용
        let img1Filename = product["이미지파일1"];
        if (!img1Filename) {
          img1Filename = `${codeSuffix}-1.jpg`;
        }
        
        const img1Path = path.join(imagesDir, img1Filename);
        
        // 이미지 다운로드
        await downloadImage(img1Url, img1Path);
        
        // 첫 번째 이미지 경로 저장
        firstImagePath = img1Path;
        
        // 이미지 캔버스 중앙에 배치 (1000x1000)
        try {
          const fileSize = await processImage(img1Path);
          onLog(`  이미지 1 캔버스 중앙 배치 완료 (1000x1000, ${fileSize.toFixed(1)}KB)`);
        } catch (error) {
          onLog(`  이미지 1 캔버스 처리 중 오류: ${error.message}`);
        }
        
        onLog(`  이미지 1 다운로드 완료: ${img1Filename}`);
        
        // 이미지 파일명과 URL 저장
        product["이미지파일1"] = img1Filename;
        product["이미지1"] = img1Url;
      } catch (error) {
        onLog(`  이미지 1 다운로드 중 오류: ${error.message}`);
        firstImagePath = null;
      }
    } else {
      onLog("  이미지 1을 찾을 수 없습니다.");
      firstImagePath = null;
    }
    
    // 2번, 3번 이미지 처리
    for (let j = 2; j <= 3; j++) {
      const imgUrl = product[`이미지${j}`];
      let imgFilename = product[`이미지파일${j}`];
      
      if (!imgFilename) {
        imgFilename = `${codeSuffix}-${j}.jpg`;
      }
      
      const imgPath = path.join(imagesDir, imgFilename);
      
      // 1번 이미지가 있고, 2번 또는 3번 이미지가 없거나 다운로드 실패한 경우
      if (firstImagePath && (!imgUrl || imgUrl === "이미지 없음")) {
        try {
          await copyFile(firstImagePath, imgPath);
          onLog(`  이미지 ${j}: 1번 이미지를 복사하여 사용`);
          
          // 이미지 파일명과 URL 저장
          product[`이미지파일${j}`] = imgFilename;
          product[`이미지${j}`] = product["이미지1"] || "이미지 없음";
        } catch (error) {
          onLog(`  이미지 ${j} 복사 중 오류: ${error.message}`);
          product[`이미지파일${j}`] = "";
          product[`이미지${j}`] = "이미지 없음";
        }
      } 
      // 2번, 3번 이미지가 있는 경우 정상적으로 다운로드
      else if (imgUrl && imgUrl !== "이미지 없음") {
        try {
          await downloadImage(imgUrl, imgPath);
          
          // 이미지 캔버스 중앙에 배치 (1000x1000)
          try {
            const fileSize = await processImage(imgPath);
            onLog(`  이미지 ${j} 캔버스 중앙 배치 완료 (1000x1000, ${fileSize.toFixed(1)}KB)`);
          } catch (error) {
            onLog(`  이미지 ${j} 캔버스 처리 중 오류: ${error.message}`);
          }
          
          onLog(`  이미지 ${j} 다운로드 완료: ${imgFilename}`);
          
          // 이미지 파일명과 URL 저장
          product[`이미지파일${j}`] = imgFilename;
          product[`이미지${j}`] = imgUrl;
        } catch (error) {
          onLog(`  이미지 ${j} 다운로드 중 오류: ${error.message}`);
          
          // 오류 발생 시 1번 이미지 복사
          if (firstImagePath) {
            try {
              await copyFile(firstImagePath, imgPath);
              onLog(`  이미지 ${j}: 오류 발생으로 1번 이미지를 복사하여 사용`);
              product[`이미지파일${j}`] = imgFilename;
              product[`이미지${j}`] = product["이미지1"] || "이미지 없음";
            } catch {
              product[`이미지파일${j}`] = "";
              product[`이미지${j}`] = "이미지 없음";
            }
          } else {
            product[`이미지파일${j}`] = "";
            product[`이미지${j}`] = "이미지 없음";
          }
        }
      } 
      // 이미지 URL이 없고 1번 이미지도 없는 경우
      else {
        product[`이미지파일${j}`] = "";
        product[`이미지${j}`] = "이미지 없음";
      }
    }
  }
  
  onLog("\n이미지 다운로드 완료");
  return imagesDir;
}

// 크롤링 결과를 엑셀 파일로 저장하는 함수
async function saveToExcel(products, resultsDir, timestamp, onLog) {
  try {
    // 파일명 생성
    const filename = path.join(resultsDir, `fredmeyer_products_${timestamp}.xlsx`);
    
    // 현재 날짜 (YYYYMMDD 형식)
    const currentDate = dayjs().format("YYYYMMDD");
    
    // 각 상품에 대표이미지, 추가이미지, 상세설명 필드 추가
    for (const product of products) {
      // 판매자 상품코드에서 날짜 부분 추출 (예: 20250305-W001 -> 20250305)
      const datePart = (product["판매자 상품코드"] || "").split("-")[0] || currentDate;
      
      // 대표이미지 필드 추가 (형식: http://www.runtower.co.kr/picture/날짜/이미지파일명)
      if (product["이미지파일1"]) {
        product["대표이미지"] = `http://www.runtower.co.kr/picture/${datePart}/${product["이미지파일1"]}`;
      } else {
        product["대표이미지"] = "";
      }
      
      // 추가이미지 필드 추가 (형식: http://www.runtower.co.kr/picture/날짜/이미지파일명)
      const additionalImages = [];
      
      // 이미지파일2가 있으면 추가
      if (product["이미지파일2"]) {
        additionalImages.push(`http://www.runtower.co.kr/picture/${datePart}/${product["이미지파일2"]}`);
      } else if (product["이미지파일1"]) {
        // 이미지파일2가 없으면 이미지파일1 사용
        additionalImages.push(`http://www.runtower.co.kr/picture/${datePart}/${product["이미지파일1"]}`);
      }
      
      // 이미지파일3이 있으면 추가
      if (product["이미지파일3"]) {
        additionalImages.push(`http://www.runtower.co.kr/picture/${datePart}/${product["이미지파일3"]}`);
      } else if (product["이미지파일1"]) {
        // 이미지파일3이 없으면 이미지파일1 사용
        additionalImages.push(`http://www.runtower.co.kr/picture/${datePart}/${product["이미지파일1"]}`);
      }
      
      // 항상 3개의 이미지 URL이 있도록 보장
      while (additionalImages.length < 3) {
        if (product["이미지파일1"]) {
          additionalImages.push(`http://www.runtower.co.kr/picture/${datePart}/${product["이미지파일1"]}`);
        } else {
          additionalImages.push("");
        }
      }
      
      // 줄바꿈으로 이미지 URL 구분
      product["추가이미지"] = additionalImages.length > 0 ? additionalImages.join("\n") : "";
      
      // 상세설명 필드 추가 (HTML 이미지 태그 형식)
      // 이미지 태그 생성
      let imgTags = "<center>\n";
      
      // 3개의 이미지 태그 추가
      for (let i = 1; i <= 3; i++) {
        const imgFilename = product[`이미지파일${i}`];
        if (imgFilename) {
          const imgUrl = `http://www.runtower.co.kr/picture/${datePart}/${imgFilename}`;
          imgTags += `<img src="${imgUrl}">\n`;
        } else if (product["이미지파일1"]) {
          // 해당 이미지가 없으면 첫 번째 이미지 사용
          const imgUrl = `http://www.runtower.co.kr/picture/${datePart}/${product["이미지파일1"]}`;
          imgTags += `<img src="${imgUrl}">\n`;
        }
      }
      
      // 마지막에 고정 이미지 추가
      imgTags += '<img src="http://www.runtower.co.kr/notice/all_bottom.png">\n';
      imgTags += "</center>";
      
      product["상세설명"] = imgTags;
    }
    
    // 엑셀 워크북 생성
    const wb = xlsx.utils.book_new();
    
    // 데이터 컬럼 순서 지정
    const columns = [
      "판매자 상품코드", "상품 링크", "상품명", "숫자 가격", 
      "이미지1", "이미지파일1", "이미지2", "이미지파일2", "이미지3", "이미지파일3",
      "대표이미지", "추가이미지", "상세설명"
    ];
    
    // 지정된 순서로 데이터 재정렬
    const orderedProducts = products.map(product => {
      const orderedProduct = {};
      columns.forEach(column => {
        orderedProduct[column] = product[column] || "";
      });
      return orderedProduct;
    });
    
    // 데이터프레임 생성
    const ws = xlsx.utils.json_to_sheet(orderedProducts);
    
    // 워크시트 추가
    xlsx.utils.book_append_sheet(wb, ws, "Sheet1");
    
    // 열 너비 설정 (간접적으로 구현)
    const colWidths = {
      A: 11,  // 판매자 상품코드
      B: 10,  // 상품 링크
      C: 10,  // 상품명
      D: 5,   // 숫자 가격
      E: 5,   // 이미지1
      F: 5,   // 이미지파일1
      G: 5,   // 이미지2
      H: 5,   // 이미지파일2
      I: 5,   // 이미지3
      J: 5,   // 이미지파일3
      K: 48,  // 대표이미지
      L: 49,  // 추가이미지
      M: 60   // 상세설명
    };
    
    // 엑셀 파일 저장
    await writeFile(filename, xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' }));
    
    // 파일 생성 확인
    if (fs.existsSync(filename)) {
      onLog(`\n크롤링 결과가 성공적으로 저장되었습니다.`);
      onLog(`파일 경로: ${filename}`);
      
      // 엑셀 파일의 상대 경로 반환 (다운로드 링크용)
      const relativePath = path.relative(process.cwd(), filename);
      return relativePath;
    } else {
      onLog("\n파일 저장 실패: 파일이 생성되지 않았습니다.");
      return null;
    }
  } catch (error) {
    onLog(`\n파일 저장 중 오류 발생: ${error.message}`);
    onLog(error.stack);
    throw error;
  }
}
