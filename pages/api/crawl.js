import { fredfmeyerCrawl } from '../../utils/crawler';

export default async function handler(req, res) {
  // API 라우트가 스트리밍을 지원하도록 설정
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const { url, maxItems, downloadImages, productCode } = req.body;

  // 로그 전송 함수
  const sendLog = (message) => {
    res.write(`data: ${JSON.stringify({ type: 'log', message })}\n\n`);
  };

  // 진행률 전송 함수
  const sendProgress = (value) => {
    res.write(`data: ${JSON.stringify({ type: 'progress', value })}\n\n`);
  };

  try {
    const result = await fredfmeyerCrawl({
      url,
      maxItems,
      downloadImages,
      productCode,
      onLog: sendLog,
      onProgress: sendProgress,
    });

    // 완료 메시지 전송
    res.write(`data: ${JSON.stringify({ type: 'complete', path: result.filePath })}\n\n`);
    res.end();
  } catch (error) {
    sendLog(`크롤링 중 오류 발생: ${error.message}`);
    res.end();
  }
}
