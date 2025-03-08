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
