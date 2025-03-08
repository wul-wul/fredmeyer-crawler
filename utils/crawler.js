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
