const https = require('https');
const tunnel = require('tunnel');

function createProxyValidationService() {
  function normalizeProxyValue(value) {
    const rawValue = String(value || '').trim();
    if (!rawValue) {
      return '';
    }

    const proxyValue = /^[a-z][a-z0-9+.-]*:\/\//i.test(rawValue)
      ? rawValue
      : /^[^/\s]+:\d+$/.test(rawValue)
        ? `http://${rawValue}`
        : rawValue;

    try {
      const parsed = new URL(proxyValue);
      if (!parsed.hostname) {
        return '';
      }

      return parsed.toString().replace(/\/$/, '');
    } catch {
      return '';
    }
  }

  function normalizeTargetUrl(targetUrl) {
    const fallbackUrl = 'https://www.javbus.com/';
    const rawValue = String(targetUrl || '').trim();
    if (!rawValue) {
      return fallbackUrl;
    }

    try {
      const parsed = new URL(rawValue);
      if (parsed.protocol !== 'https:') {
        return fallbackUrl;
      }

      return parsed.toString();
    } catch {
      return fallbackUrl;
    }
  }

  function createProxyAgent(proxyUrl) {
    const parsedProxy = new URL(proxyUrl);
    const port =
      Number.parseInt(parsedProxy.port, 10) || (parsedProxy.protocol === 'https:' ? 443 : 80);
    const proxyOptions = {
      proxy: {
        host: parsedProxy.hostname,
        port
      }
    };

    if (parsedProxy.username || parsedProxy.password) {
      proxyOptions.proxy.proxyAuth = `${decodeURIComponent(parsedProxy.username)}:${decodeURIComponent(parsedProxy.password)}`;
    }

    if (parsedProxy.protocol === 'http:') {
      return tunnel.httpsOverHttp(proxyOptions);
    }

    if (parsedProxy.protocol === 'https:') {
      return tunnel.httpsOverHttps(proxyOptions);
    }

    throw new Error('当前仅支持 HTTP / HTTPS 代理');
  }

  function probeProxy(proxyUrl, targetUrl) {
    return new Promise((resolve, reject) => {
      const parsedTarget = new URL(targetUrl);
      const agent = createProxyAgent(proxyUrl);
      const startedAt = Date.now();
      const request = https.request(
        {
          protocol: parsedTarget.protocol,
          host: parsedTarget.hostname,
          port: Number.parseInt(parsedTarget.port, 10) || 443,
          path: `${parsedTarget.pathname || '/'}${parsedTarget.search || ''}`,
          method: 'HEAD',
          agent,
          timeout: 6000,
          rejectUnauthorized: false,
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
          }
        },
        (response) => {
          const statusCode = Number(response.statusCode) || 0;
          response.resume();

          if (statusCode === 407) {
            reject(new Error('代理认证失败'));
            return;
          }

          if (statusCode > 0 && statusCode < 500) {
            resolve({
              statusCode,
              latencyMs: Date.now() - startedAt
            });
            return;
          }

          reject(new Error(`目标站点响应异常（${statusCode || '无状态码'}）`));
        }
      );

      request.on('timeout', () => {
        request.destroy(new Error('连接超时'));
      });

      request.on('error', (error) => {
        reject(error);
      });

      request.end();
    });
  }

  async function validateProxy(proxyValue, options = {}) {
    const rawValue = String(proxyValue || '').trim();
    if (!rawValue) {
      return {
        status: 'empty',
        normalizedProxy: '',
        message: '代理未填写',
        detail: '当前将使用直连方式运行。'
      };
    }

    const normalizedProxy = normalizeProxyValue(rawValue);
    if (!normalizedProxy) {
      return {
        status: 'invalid',
        normalizedProxy: '',
        message: '代理失败',
        detail: '代理地址格式无效，请检查协议、地址和端口。'
      };
    }

    try {
      const result = await probeProxy(normalizedProxy, normalizeTargetUrl(options.targetUrl));
      return {
        status: 'valid',
        normalizedProxy,
        message: '代理正常',
        detail: `检测通过，当前连通延迟约 ${result.latencyMs} ms。`,
        latencyMs: result.latencyMs
      };
    } catch (error) {
      return {
        status: 'invalid',
        normalizedProxy,
        message: '代理失败',
        detail: error instanceof Error ? error.message : String(error)
      };
    }
  }

  return {
    normalizeProxyValue,
    validateProxy
  };
}

module.exports = {
  createProxyValidationService
};
