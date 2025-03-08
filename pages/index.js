import { useState, useRef } from 'react';
import Head from 'next/head';
import styles from '../styles/Home.module.css';

export default function Home() {
  const [url, setUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState([]);
  const [maxItems, setMaxItems] = useState(200);
  const [downloadImages, setDownloadImages] = useState(true);
  const [productCode, setProductCode] = useState('20250305-W001');
  const [resultPath, setResultPath] = useState('');
  const logsEndRef = useRef(null);

  // 로그 자동 스크롤
  const scrollToBottom = () => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // 로그 추가 함수
  const addLog = (message) => {
    setLogs(prevLogs => [...prevLogs, message]);
    setTimeout(scrollToBottom, 100);
  };

  // 크롤링 시작
  const startCrawling = async () => {
    if (!url.trim()) {
      alert('URL을 입력해주세요.');
      return;
    }

    setIsLoading(true);
    setLogs([]);
    setProgress(0);
    setResultPath('');

    try {
      addLog('=== 프레드메이어 상품 크롤링 시작 ===');
      addLog(`대상 URL: ${url}`);

      const response = await fetch('/api/crawl', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url,
          maxItems,
          downloadImages,
          productCode,
        }),
      });

      // 스트림 응답 처리를 위한 리더 설정
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value);
        const events = text.split('\n\n').filter(Boolean);

        for (const event of events) {
          if (event.startsWith('data:')) {
            const data = JSON.parse(event.slice(5));
            
            if (data.type === 'log') {
              addLog(data.message);
            } else if (data.type === 'progress') {
              setProgress(data.value);
            } else if (data.type === 'complete') {
              setResultPath(data.path);
              addLog(`\n크롤링이 완료되었습니다. 파일 경로: ${data.path}`);
            }
          }
        }
      }
    } catch (error) {
      addLog(`\n크롤링 중 오류 발생: ${error.message}`);
    } finally {
      setIsLoading(false);
      setProgress(100);
    }
  };

  return (
    <div className={styles.container}>
      <Head>
        <title>프레드메이어 크롤러</title>
        <meta name="description" content="프레드메이어 웹사이트 크롤러" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main className={styles.main}>
        <h1 className={styles.title}>프레드메이어 크롤러</h1>

        <div className={styles.urlContainer}>
          <input
            type="text"
            className={styles.urlInput}
            placeholder="URL 입력"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={isLoading}
          />
          <div className={styles.buttonGroup}>
            <button
              className={styles.button}
              onClick={startCrawling}
              disabled={isLoading}
            >
              {isLoading ? '크롤링 중...' : '크롤링 시작'}
            </button>
            <button
              className={styles.button}
              onClick={() => window.location.reload()}
              disabled={!isLoading}
            >
              크롤링 중지
            </button>
          </div>
        </div>

        <div className={styles.optionsContainer}>
          <div className={styles.optionGroup}>
            <label>최대 크롤링 개수:</label>
            <input
              type="number"
              min="1"
              max="200"
              value={maxItems}
              onChange={(e) => setMaxItems(parseInt(e.target.value))}
              disabled={isLoading}
              className={styles.numberInput}
            />
          </div>

          <div className={styles.optionGroup}>
            <label>
              <input
                type="checkbox"
                checked={downloadImages}
                onChange={(e) => setDownloadImages(e.target.checked)}
                disabled={isLoading}
              />
              이미지 자동 다운로드
            </label>
          </div>
        </div>

        <div className={styles.codeContainer}>
          <label>판매자 상품코드 설정:</label>
          <input
            type="text"
            value={productCode}
            onChange={(e) => setProductCode(e.target.value)}
            disabled={isLoading}
            placeholder="20250305-W001"
            className={styles.codeInput}
          />
          <span>(예: 20250305-W001)</span>
        </div>

        <div className={styles.progressContainer}>
          <div className={styles.progressBar}>
            <div
              className={styles.progressFill}
              style={{ width: `${progress}%` }}
            ></div>
          </div>
        </div>

        <div className={styles.logsContainer}>
          <h3>크롤링 로그</h3>
          <div className={styles.logs}>
            {logs.map((log, index) => (
              <div key={index} className={styles.logEntry}>
                {log}
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        </div>

        {resultPath && (
          <div className={styles.result}>
            
              href={`/api/download?path=${encodeURIComponent(resultPath)}`}
  className={styles.downloadButton}
  download
>
  결과 파일 다운로드
</a>
          </div>
        )}
      </main>
    </div>
  );
}
