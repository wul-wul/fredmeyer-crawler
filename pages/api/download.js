import fs from 'fs';
import path from 'path';

export default function handler(req, res) {
  const { path: filePath } = req.query;
  
  // 경로 검증 (보안 문제 방지)
  const safePath = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, '');
  const fullPath = path.join(process.cwd(), safePath);
  
  try {
    if (fs.existsSync(fullPath)) {
      const stat = fs.statSync(fullPath);
      
      // 파일 MIME 타입 설정
      const extension = path.extname(fullPath).toLowerCase();
      let contentType = 'application/octet-stream';
      
      if (extension === '.xlsx') {
        contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      } else if (extension === '.jpg' || extension === '.jpeg') {
        contentType = 'image/jpeg';
      } else if (extension === '.png') {
        contentType = 'image/png';
      }
      
      // 파일명 헤더 설정
      const fileName = path.basename(fullPath);
      res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', stat.size);
      
      // 파일 스트림 생성 및 전송
      const fileStream = fs.createReadStream(fullPath);
      fileStream.pipe(res);
    } else {
      res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
