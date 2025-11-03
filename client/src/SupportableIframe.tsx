import React from 'react';

const SupportableIframe: React.FC = () => {
  return (
    <div style={{ width: '100%', height: '600px' }}>
      <iframe
        src="/supportable/web/index.html"
        title="Supportable Web Client"
        style={{ width: '100%', height: '100%', border: 'none' }}
      ></iframe>
    </div>
  );
};

export default SupportableIframe;
