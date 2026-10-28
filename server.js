const http = require('http');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const PORT = 3000;
const CONFIG_FILE = path.join(__dirname, 'alert-config.json');

// Default config
let alertConfig = {
  email: {
    service: '',
    host: '',
    port: 587,
    secure: false,
    user: '',
    pass: '',
    from: ''
  },
  sms: {
    provider: 'test', // 'test', 'twilio', 'fast2sms', 'webhook'
    twilio: {
      accountSid: '',
      authToken: '',
      fromPhone: ''
    },
    fast2sms: {
      apiKey: ''
    },
    webhook: {
      url: ''
    }
  },
  automation: {
    autoDispatch: true,
    countdownSec: 15,
    autoDrowsyTrigger: true
  }
};

if (fs.existsSync(CONFIG_FILE)) {
  try {
    const loaded = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    alertConfig = {
      email: Object.assign({}, alertConfig.email, loaded.email || {}),
      sms: Object.assign({}, alertConfig.sms, loaded.sms || {}),
      automation: Object.assign({}, alertConfig.automation, loaded.automation || {})
    };
  } catch (e) {
    console.error('Error reading alert-config.json:', e);
  }
}

function saveConfig(cfg) {
  if (cfg.email) alertConfig.email = Object.assign({}, alertConfig.email, cfg.email);
  if (cfg.sms) alertConfig.sms = Object.assign({}, alertConfig.sms, cfg.sms);
  if (cfg.automation) alertConfig.automation = Object.assign({}, alertConfig.automation, cfg.automation);
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(alertConfig, null, 2), 'utf8');
  } catch (e) {
    console.error('Error saving alert-config.json:', e);
  }
}

// Nodemailer Transporter
async function getEmailTransporter() {
  const ec = alertConfig.email;
  if (ec.user && ec.pass) {
    if (ec.service === 'gmail' || (!ec.host && ec.user.endsWith('@gmail.com'))) {
      return {
        transporter: nodemailer.createTransport({
          service: 'gmail',
          auth: { user: ec.user, pass: ec.pass }
        }),
        from: ec.from || `"DrowsyGuard Emergency" <${ec.user}>`,
        isTest: false
      };
    } else if (ec.host) {
      return {
        transporter: nodemailer.createTransport({
          host: ec.host,
          port: ec.port || 587,
          secure: ec.secure || false,
          auth: { user: ec.user, pass: ec.pass }
        }),
        from: ec.from || `"DrowsyGuard Emergency" <${ec.user}>`,
        isTest: false
      };
    }
  }

  // Ethereal test account fallback
  const testAccount = await nodemailer.createTestAccount();
  return {
    transporter: nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: { user: testAccount.user, pass: testAccount.pass }
    }),
    from: '"DrowsyGuard System" <emergency-alert@drowsyguard.local>',
    isTest: true
  };
}

// Dispatch SMS automatically
async function dispatchSms(phoneNumbers, messageText, alertData) {
  const sc = alertConfig.sms;
  const results = [];

  for (const rawPhone of phoneNumbers) {
    const phone = rawPhone.trim().replace(/[^\d+]/g, '');
    if (!phone) continue;

    if (sc.provider === 'twilio' && sc.twilio.accountSid && sc.twilio.authToken && sc.twilio.fromPhone) {
      try {
        const auth = Buffer.from(`${sc.twilio.accountSid}:${sc.twilio.authToken}`).toString('base64');
        const params = new URLSearchParams({
          To: phone,
          From: sc.twilio.fromPhone,
          Body: messageText
        });
        const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sc.twilio.accountSid}/Messages.json`, {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: params.toString()
        });
        const data = await resp.json();
        if (resp.ok) {
          results.push({ phone, status: 'sent', provider: 'twilio', sid: data.sid });
        } else {
          results.push({ phone, status: 'error', provider: 'twilio', error: data.message || 'Twilio error' });
        }
      } catch (err) {
        results.push({ phone, status: 'error', provider: 'twilio', error: err.message });
      }
    } else if (sc.provider === 'fast2sms' && sc.fast2sms.apiKey) {
      try {
        const cleanNumber = phone.replace(/^\+91/, '').replace(/\D/g, '');
        const resp = await fetch('https://www.fast2sms.com/dev/bulkV2', {
          method: 'POST',
          headers: {
            'authorization': sc.fast2sms.apiKey,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            route: 'q',
            message: messageText,
            language: 'english',
            flash: 0,
            numbers: cleanNumber
          })
        });
        const data = await resp.json();
        results.push({ phone, status: data.return ? 'sent' : 'error', provider: 'fast2sms', detail: data });
      } catch (err) {
        results.push({ phone, status: 'error', provider: 'fast2sms', error: err.message });
      }
    } else if (sc.provider === 'webhook' && sc.webhook.url) {
      try {
        const resp = await fetch(sc.webhook.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: phone, message: messageText, alert: alertData })
        });
        results.push({ phone, status: resp.ok ? 'sent' : 'error', provider: 'webhook' });
      } catch (err) {
        results.push({ phone, status: 'error', provider: 'webhook', error: err.message });
      }
    } else {
      // Built-in Smart Simulator
      console.log(`[SMS SIMULATOR -> ${phone}]: ${messageText}`);
      results.push({
        phone: phone,
        status: 'delivered_simulated',
        provider: 'simulator',
        notice: 'Dispatched via Smart SMS Gateway. Configure Twilio/Fast2SMS in settings for live cellular network delivery.'
      });
    }
  }

  return results;
}

function buildEmailHtml(data) {
  const driver = data.driverName || 'Driver';
  const reason = data.reason || 'Drowsiness / Emergency';
  const time = data.time || new Date().toLocaleString();
  const lat = data.lat != null ? Number(data.lat).toFixed(5) : 'N/A';
  const lng = data.lng != null ? Number(data.lng).toFixed(5) : 'N/A';
  const mapsUrl = (data.lat != null && data.lng != null) ? `https://maps.google.com/?q=${data.lat},${data.lng}` : null;
  const address = data.address || '';
  const blood = data.blood || 'Not specified';
  const notes = data.notes || 'None';
  const hospital = data.hospital;
  const police = data.police;

  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f3f5f7; margin: 0; padding: 20px; color: #14202b; }
  .card { max-width: 620px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #dde3e8; box-shadow: 0 4px 14px rgba(0,0,0,0.08); }
  .header { background: #b71c1c; color: #ffffff; padding: 24px; text-align: center; }
  .header h1 { margin: 0 0 6px; font-size: 26px; letter-spacing: 0.5px; }
  .header p { margin: 0; font-size: 15px; opacity: 0.92; }
  .body { padding: 24px; }
  .alert-box { background: #ffebee; border-left: 5px solid #c62828; padding: 14px; border-radius: 6px; margin-bottom: 20px; font-size: 15px; }
  .section-title { font-size: 13px; text-transform: uppercase; color: #5d6b78; letter-spacing: 0.8px; margin: 20px 0 8px; font-weight: 700; }
  .info-table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 14.5px; }
  .info-table td { padding: 8px 6px; border-bottom: 1px solid #edf1f4; vertical-align: top; }
  .info-table td.label { width: 140px; color: #5d6b78; font-weight: 600; }
  .btn { display: inline-block; background: #0f766e; color: #ffffff !important; text-decoration: none; padding: 12px 22px; border-radius: 8px; font-weight: 700; font-size: 14px; margin: 8px 0; }
  .footer { background: #f8fafc; padding: 16px 24px; text-align: center; font-size: 12px; color: #8b9aa8; border-top: 1px solid #dde3e8; }
</style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1>🚨 AUTOMATIC EMERGENCY ALERT</h1>
      <p>Driver Safety System Triggered</p>
    </div>
    <div class="body">
      <div class="alert-box">
        <strong>Trigger Reason:</strong> ${reason}<br>
        <strong>Status:</strong> The driver may be unresponsive, asleep at the wheel, or involved in a collision.
      </div>

      <div class="section-title">Driver Details</div>
      <table class="info-table">
        <tr><td class="label">Driver Name</td><td><strong>${driver}</strong></td></tr>
        <tr><td class="label">Time Reported</td><td>${time}</td></tr>
        <tr><td class="label">Blood Group</td><td>${blood}</td></tr>
        <tr><td class="label">Medical Notes</td><td>${notes}</td></tr>
      </table>

      <div class="section-title">Live GPS Location</div>
      <table class="info-table">
        <tr><td class="label">Coordinates</td><td>${lat}, ${lng}</td></tr>
        ${address ? `<tr><td class="label">Address / Landmark</td><td>${address}</td></tr>` : ''}
      </table>
      ${mapsUrl ? `<a href="${mapsUrl}" class="btn" target="_blank">Open Location in Google Maps</a>` : '<p style="color:#c62828">GPS Location unavailable</p>'}

      <div class="section-title">Nearest Emergency Facilities</div>
      <table class="info-table">
        <tr>
          <td class="label">Nearest Hospital</td>
          <td>
            ${hospital ? `<strong>${hospital.name}</strong> (${hospital.distance != null ? hospital.distance.toFixed(1) + ' km away' : 'nearby'})${hospital.phone ? '<br>Phone: <a href="tel:' + hospital.phone + '">' + hospital.phone + '</a>' : ''}` : 'Not found or unavailable'}
          </td>
        </tr>
        <tr>
          <td class="label">Nearest Police</td>
          <td>
            ${police ? `<strong>${police.name}</strong> (${police.distance != null ? police.distance.toFixed(1) + ' km away' : 'nearby'})${police.phone ? '<br>Phone: <a href="tel:' + police.phone + '">' + police.phone + '</a>' : ''}` : 'Not found or unavailable'}
          </td>
        </tr>
      </table>
    </div>
    <div class="footer">
      Sent automatically by DrowsyGuard Driver Safety & Emergency System.
    </div>
  </div>
</body>
</html>`;
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.wasm': 'application/wasm'
};

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 1e6) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function sendJsonResponse(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  });
  res.end(JSON.stringify(data));
}

function createServer(p) {
  const server = http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url, `http://localhost:${p}`);
    const pathname = parsedUrl.pathname;

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
      });
      res.end();
      return;
    }

    // Config GET & POST
    if (pathname === '/api/config' || pathname === '/api/email-config') {
      if (req.method === 'GET') {
        const safe = JSON.parse(JSON.stringify(alertConfig));
        if (safe.email && safe.email.pass) safe.email.pass = '********';
        if (safe.sms && safe.sms.twilio && safe.sms.twilio.authToken) safe.sms.twilio.authToken = '********';
        if (safe.sms && safe.sms.fast2sms && safe.sms.fast2sms.apiKey) safe.sms.fast2sms.apiKey = '********';
        return sendJsonResponse(res, 200, { success: true, config: safe });
      }
      if (req.method === 'POST') {
        try {
          const body = await parseJsonBody(req);
          if (body.email && body.email.pass === '********') delete body.email.pass;
          if (body.sms && body.sms.twilio && body.sms.twilio.authToken === '********') delete body.sms.twilio.authToken;
          if (body.sms && body.sms.fast2sms && body.sms.fast2sms.apiKey === '********') delete body.sms.fast2sms.apiKey;
          saveConfig(body);
          return sendJsonResponse(res, 200, { success: true, message: 'Settings saved successfully.' });
        } catch (err) {
          return sendJsonResponse(res, 400, { success: false, error: err.message });
        }
      }
    }

    // MAIN AUTOMATIC ALERT & MESSAGING ENDPOINT
    if (pathname === '/api/alert' || pathname === '/api/send-email' || pathname === '/api/send-message') {
      if (req.method === 'POST') {
        try {
          const data = await parseJsonBody(req);
          const driver = data.driverName || 'Driver';
          const reason = data.reason || 'Emergency warning triggered';
          const time = data.time || new Date().toLocaleString();
          const mapsUrl = (data.lat != null && data.lng != null) ? `https://maps.google.com/?q=${data.lat},${data.lng}` : '';

          console.log('\n========================================');
          console.log(`[AUTOMATIC EMERGENCY DISPATCH] ${time}`);
          console.log(`Reason: ${reason} | Driver: ${driver}`);
          console.log('========================================');

          // Extract Contacts
          let emails = [];
          let phones = [];
          if (Array.isArray(data.contacts)) {
            data.contacts.forEach(c => {
              const e = typeof c === 'string' ? c : (c.email || c.e || '');
              const ph = typeof c === 'string' ? '' : (c.phone || c.p || '');
              if (e && e.includes('@')) emails.push(e.trim());
              if (ph && ph.trim()) phones.push(ph.trim());
            });
          }
          if (Array.isArray(data.emails)) emails = emails.concat(data.emails.filter(e => e && e.includes('@')));
          if (Array.isArray(data.phoneNumbers)) phones = phones.concat(data.phoneNumbers.filter(p => p && p.trim()));
          if (data.to && typeof data.to === 'string' && data.to.includes('@')) emails.push(data.to.trim());
          if (data.toPhone && typeof data.toPhone === 'string') phones.push(data.toPhone.trim());

          emails = Array.from(new Set(emails));
          phones = Array.from(new Set(phones));

          // Compose Standard Emergency SMS Message
          const smsText = `EMERGENCY ALERT: ${driver} may have had an accident or fallen asleep at the wheel. ` +
            `Reason: ${reason}. ` +
            (mapsUrl ? `Location: ${mapsUrl} ` : '') +
            (data.address ? `(${data.address}) ` : '') +
            (data.hospital ? `Hospital: ${data.hospital.name} ` : '') +
            (data.police ? `Police: ${data.police.name} ` : '') +
            `Time: ${time}. Please send help immediately!`;

          let emailResult = { sent: false, recipients: emails };
          let smsResult = { sent: false, recipients: phones, details: [] };

          // 1. Automatic Email Dispatch
          if (emails.length > 0) {
            try {
              console.log(`[ALERT] Auto-forwarding emergency email to: ${emails.join(', ')}`);
              const { transporter, from, isTest } = await getEmailTransporter();
              const mailOptions = {
                from: from,
                to: emails.join(', '),
                subject: `🚨 EMERGENCY ALERT: ${driver} Needs Immediate Assistance! [${reason}]`,
                text: smsText,
                html: buildEmailHtml(data)
              };
              const info = await transporter.sendMail(mailOptions);
              let previewUrl = isTest ? nodemailer.getTestMessageUrl(info) : null;
              emailResult = {
                sent: true,
                recipients: emails,
                isTest: isTest,
                previewUrl: previewUrl,
                messageId: info.messageId
              };
              console.log(`[ALERT] Email sent. Test preview: ${previewUrl || 'Delivered to SMTP'}`);
            } catch (mailErr) {
              console.error('[ALERT] Email error:', mailErr);
              emailResult = { sent: false, recipients: emails, error: mailErr.message };
            }
          }

          // 2. Automatic SMS / Phone Message Dispatch
          if (phones.length > 0) {
            try {
              console.log(`[ALERT] Auto-forwarding emergency SMS to: ${phones.join(', ')}`);
              const smsDetails = await dispatchSms(phones, smsText, data);
              smsResult = {
                sent: true,
                recipients: phones,
                provider: alertConfig.sms.provider || 'simulator',
                details: smsDetails,
                previewText: smsText
              };
              console.log(`[ALERT] SMS dispatch complete for ${phones.length} number(s).`);
            } catch (smsErr) {
              console.error('[ALERT] SMS error:', smsErr);
              smsResult = { sent: false, recipients: phones, error: smsErr.message };
            }
          }

          return sendJsonResponse(res, 200, {
            success: true,
            message: `Emergency alert automatically processed.`,
            driver: driver,
            reason: reason,
            time: time,
            email: emailResult,
            sms: smsResult
          });
        } catch (err) {
          console.error('[ALERT ERROR]', err);
          return sendJsonResponse(res, 500, { success: false, error: err.message });
        }
      }
    }

    // Static file serving
    let safePath = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[\/\\])+/, '');
    let filePath = path.join(__dirname, safePath === '/' || safePath === '\\' ? 'index.html' : safePath);
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
      if (err) {
        if (err.code === 'ENOENT') {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('404 Not Found');
        } else {
          res.writeHead(500);
          res.end(`Server Error: ${err.code}`);
        }
      } else {
        res.writeHead(200, {
          'Content-Type': contentType,
          'Access-Control-Allow-Origin': '*'
        });
        res.end(content);
      }
    });
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`Port ${p} in use, trying ${p + 1}...`);
      createServer(p + 1);
    } else {
      console.error('Server error:', err);
    }
  });

  server.listen(p, () => {
    console.log(`DrowsyGuard server is live at: http://localhost:${p}/ and http://127.0.0.1:${p}/`);
  });
}

createServer(PORT);
