var sendRequest = function(method, url, headers, data = null) {
  return new Promise(function(resolve, reject) {
    let xhr = new XMLHttpRequest();
    xhr.open(method, url, true);

    if (headers) {
      for (let key in headers) {
        xhr.setRequestHeader(key, headers[key]);
      }
    }

    xhr.onload = function() {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.responseText);
      } else {
        reject(xhr.responseText);
      }
    };

    xhr.onerror = function() {
      reject(xhr.statusText);
    };

    xhr.send(data);
  });
};

var detectCsrfTokenFromResponseText = function(responseText, formId) {
  const parser = new DOMParser();
  const htmlResult = parser.parseFromString(responseText, 'text/html');
  const meta = htmlResult.querySelector(`meta[name="csrf-token"]`);
  if (!meta || typeof meta.content !== 'string' || !meta.content.trim()) {
    const context = formId ? ` for form '${formId}'` : '';
    const error = new Error(`Unable to locate CSRF token${context}.`);
    error.code = 'CSRF_TOKEN_MISSING';
    throw error;
  }
  return meta.content;
};

var submitFormSecurely = function(formObj) {
  if (!formObj || !formObj.action) {
    return Promise.reject(new Error('Invalid form element.'));
  }
  const url = formObj.action;
  const method = formObj.method;
  const data = Object.fromEntries(new FormData(formObj).entries());
  const headers = {
    'Content-type': 'application/json; charset=UTF-8',
    'X-CSRF-Token': data.authenticity_token
  }
  const markData = {
    ...data,
    skip_error: true
  }

  return new Promise(function(resolve, reject) {
    sendRequest(method, url, headers, JSON.stringify(markData))
      .then(resolve)
      .catch(function() {
        let rawResponse = null;
        try {
          if (window.parent && window.parent !== window && window.parent.__sreaderFunc__) {
            rawResponse = window.parent.__sreaderFunc__.contentInfo;
          }
        } catch { }
        if (!rawResponse) {
          try {
            if (typeof __sreaderFunc__ !== 'undefined' && __sreaderFunc__ && __sreaderFunc__.contentInfo) {
              rawResponse = __sreaderFunc__.contentInfo;
            }
          } catch { }
        }
        const rentalEpisodeURL = Array.isArray(rawResponse?.items) && rawResponse.items[0]
          ? rawResponse.items[0].RentalEpisodeURL
          : null;
        if (!rentalEpisodeURL) {
          reject(new Error('Unable to resolve RentalEpisodeURL for CSRF refresh.'));
          return;
        }
        sendRequest('GET', rentalEpisodeURL)
          .then(function(responseText){
            let csrfToken;
            try {
              csrfToken = detectCsrfTokenFromResponseText(responseText, formObj.id);
            } catch (tokenError) {
              reject(tokenError);
              return;
            }
            const newHeaders = {
              ...headers,
              'X-CSRF-Token': csrfToken
            }
            const newData = {
              ...data,
              authenticity_token: csrfToken
            }
            sendRequest(method, url, newHeaders, JSON.stringify(newData))
              .then(resolve)
              .catch(reject)
          })
          .catch(reject)
      });
  });
}

var emToPxByFontSize = function(em, element) {
  if (typeof em !== 'number' || em < 0) {
    throw new Error('Invalid em value. It should be a non-negative number.');
  }
  if (!(element instanceof HTMLElement)) {
    throw new Error('Invalid element. It should be a valid HTML element.');
  }
  const fontSize = parseFloat(getComputedStyle(element).fontSize);
  return em * fontSize;
};

class AutoFontSize {
  constructor(boxId, scale = 32, maxFontSize = null) {
    this.box = document.getElementById(boxId);
    this.observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        const fontSize = Math.max(width / scale, 0);
        if (maxFontSize && fontSize > maxFontSize) {
          return;
        }
        this.box.style.setProperty('font-size', `${fontSize}px`);
      }
    });
  }

  resize() {
    this.observer.observe(this.box);
  }
};
