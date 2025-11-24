export const loadGoogleScripts = () => {
  return new Promise<void>((resolve, reject) => {
    if ((window as any).google?.accounts?.oauth2) {
      resolve();
      return;
    }
    
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = (e) => reject(e);
    document.body.appendChild(script);
  });
};

export const uploadToDrive = async (
  blob: Blob, 
  filename: string, 
  accessToken: string,
  onProgress?: (progress: number) => void
) => {
  const metadata = {
    name: filename,
    mimeType: blob.type,
  };

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', blob);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart');
    xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
    
    if (onProgress) {
        xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
                onProgress((event.loaded / event.total) * 100);
            }
        };
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.response));
      } else {
        reject(new Error(`Upload failed: ${xhr.statusText}`));
      }
    };

    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(form);
  });
};