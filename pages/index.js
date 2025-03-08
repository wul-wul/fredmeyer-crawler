import { useState, useRef } from 'react';
import Head from 'next/head';

export default function Home() {
  const [url, setUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState([]);
  const [maxItems, setMaxItems] = useState(200);
  const [downloadImages, setDownloadImages] = useState(true);
  const [productCode, setProductCode] = useState('20250305-W001');
  const logsEndRef = useRef(null);
  const timersRef = useRef([]);
  const [downloadReady, setDownloadReady] = useState(false);
  const [timestamp, setTimestamp] = useState('');

  // 로그 스크롤 함수
  const scrollToBottom = () => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // 로그 추가 함수
  const addLog = (message) => {
    setLogs(prevLogs => [...prevLogs, message]);
    setTimeout(scrollToBottom, 100);
  };

  // 크롤링 중지 함수
  const stopCrawling = () => {
    // 모든 타이머 정리
    timersRef.current.forEach(timerId => clearTimeout(timerId));
    timersRef.current = [];
    
    // 로그 추가 및 상태 변경
    addLog('사용자가 크롤링을 중지했습니다.');
    setIsLoading(false);
  };

  // 크롤링 시작 함수
  const startCrawling = async () => {
    if (!url.trim()) {
      alert('URL을 입력해주세요.');
      return;
    }

    // 이전 타이머들 정리
    timersRef.current.forEach(timerId => clearTimeout(timerId));
    timersRef.current = [];

    setIsLoading(true);
    setLogs([]);
    setDownloadReady(false);

    try {
      // API 호출
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
              setTimestamp(data.timestamp);
              setDownloadReady(true);
              addLog(`\n크롤링이 완료되었습니다. 결과 파일을 다운로드하세요.`);
            }
          }
        }
      }
    } catch (error) {
      addLog(`\n크롤링 중 오류 발생: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto' }}>
      <Head>
        <title>프레드메이어 크롤러</title>
      </Head>

      <h1 style={{ textAlign: 'center' }}>프레드메이어 크롤러</h1>
      
      {/* URL 입력 영역 */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
        <input
          type="text"
          placeholder="URL 입력"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          style={{ flex: 1, padding: '8px' }}
          disabled={isLoading}
        />
        <button 
          style={{ 
            padding: '8px 16px', 
            backgroundColor: isLoading ? '#ccc' : '#0070f3', 
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: isLoading ? 'not-allowed' : 'pointer'
          }}
          onClick={startCrawling}
          disabled={isLoading}
        >
          {isLoading ? '크롤링 중...' : '크롤링 시작'}
        </button>
        <button 
          style={{ 
            padding: '8px 16px', 
            backgroundColor: !isLoading ? '#ccc' : '#f44336', 
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: !isLoading ? 'not-allowed' : 'pointer'
          }}
          onClick={stopCrawling}
          disabled={!isLoading}
        >
          크롤링 중지
        </button>
      </div>
      
      {/* 크롤링 옵션 영역 */}
      <div style={{ 
        border: '1px solid #ddd', 
        borderRadius: '4px', 
        padding: '10px',
        marginBottom: '20px'
      }}>
        <h3 style={{ margin: '0 0 10px 0' }}>크롤링 옵션</h3>
        
        <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
          {/* 최대 크롤링 개수 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <label>최대 크롤링 개수:</label>
            <input
              type="number"
              min="1"
              max="200"
              value={maxItems}
              onChange={(e) => setMaxItems(parseInt(e.target.value))}
              disabled={isLoading}
              style={{ width: '60px', padding: '4px' }}
            />
          </div>
          
          {/* 이미지 다운로드 옵션 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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
        
        {/* 판매자 상품코드 설정 */}
        <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <label>판매자 상품코드 설정:</label>
          <input
            type="text"
            value={productCode}
            onChange={(e) => setProductCode(e.target.value)}
            disabled={isLoading}
            placeholder="20250305-W001"
            style={{ width: '150px', padding: '4px' }}
          />
          <span>(예: 20250305-W001)</span>
        </div>
      </div>
      
      {/* 진행 상태 표시줄 */}
      {isLoading && (
        <div style={{ marginBottom: '20px' }}>
          <div style={{ 
            width: '100%', 
            height: '20px', 
            backgroundColor: '#f0f0f0',
            borderRadius: '10px',
            overflow: 'hidden'
          }}>
            <div style={{
              height: '100%',
              width: `${progress}%`,
              backgroundColor: '#0070f3',
              transition: 'width 0.3s ease'
            }}></div>
          </div>
        </div>
      )}
      
      {/* 로그 영역 */}
      <div style={{ 
        border: '1px solid #ccc', 
        borderRadius: '4px', 
        padding: '10px',
        height: '300px',
        overflowY: 'auto',
        backgroundColor: '#f5f5f5',
        fontFamily: 'monospace'
      }}>
        <h3>크롤링 로그</h3>
        {logs.length > 0 ? (
          logs.map((log, index) => (
            <div key={index} style={{ marginBottom: '4px' }}>
              {log}
            </div>
          ))
        ) : (
          <p style={{ color: '#888' }}>크롤링 시작 버튼을 클릭하면 로그가 여기에 표시됩니다.</p>
        )}
        <div ref={logsEndRef} />
      </div>

      {/* 다운로드 버튼 영역 */}
      {downloadReady && (
        <div style={{ marginTop: '20px', textAlign: 'center' }}>
          <a 
            href={`/api/download?type=excel&timestamp=${timestamp}`}
            style={{ 
              padding: '10px 20px', 
              backgroundColor: '#4CAF50', 
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              marginRight: '10px',
              fontSize: '16px',
              textDecoration: 'none',
              display: 'inline-block'
            }}
          >
            엑셀 파일 다운로드
          </a>
          
          {downloadImages && (
            <a 
              href={`/api/download?type=images&timestamp=${timestamp}`}
              style={{ 
                padding: '10px 20px', 
                backgroundColor: '#2196F3', 
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '16px',
                textDecoration: 'none',
                display: 'inline-block'
              }}
            >
              이미지 파일 다운로드
            </a>
          )}
        </div>
      )}
    </div>
  );
}
