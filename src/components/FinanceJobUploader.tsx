import React, { useState } from 'react';
import { FinanceJobClient } from './FinanceJobClient';

export function FinanceJobUploader() {
  const [file, setFile] = useState<File | null>(null);
  const [rawDocument, setRawDocument] = useState<string>('');
  const [start, setStart] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successData, setSuccessData] = useState<any>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setSuccessData(null);
    setErrorMsg(null);
    setStart(false);
    const selected = e.target.files && e.target.files[0] ? e.target.files[0] : null;
    setFile(selected);

    if (selected) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result;
        if (typeof text === 'string') {
          setRawDocument(text);
        } else {
          setErrorMsg('Failed to read file as text');
        }
      };
      reader.readAsText(selected);
    }
  }

  return (
    <div>
      <input type="file" accept=".txt,.pdf,.docx" onChange={handleFileChange} />
      {file && !start && <button onClick={() => setStart(true)}>Start Extraction</button>}
      {errorMsg && <div style={{ color: 'red' }}>{errorMsg}</div>}
      {start && rawDocument && (
        <FinanceJobClient
          rawDocument={rawDocument}
          onSuccess={(data) => {
            setSuccessData(data);
            setStart(false);
          }}
          onError={(error) => {
            setErrorMsg(error);
            setStart(false);
          }}
        />
      )}
      {successData && <pre>{JSON.stringify(successData, null, 2)}</pre>}
    </div>
  );
}
