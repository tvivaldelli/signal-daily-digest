import { Resend } from 'resend';

let resend;
function getResend() {
  if (!resend) resend = new Resend(process.env.RESEND_API_KEY);
  return resend;
}
const FROM_ADDRESS = 'onboarding@resend.dev';
const APP_URL = process.env.APP_URL || 'https://mortgage-intel-hub.replit.app';

/**
 * Build the HTML email body for a daily digest
 * @param {Object} digestData - The digest object from insightsGenerator
 * @param {Array|null} weeklyBullets - Optional weekly summary bullets (Fridays)
 * @returns {string} HTML email body
 */
export function buildDigestHtml(digestData, weeklyBullets = null) {
  const date = new Date(digestData.date || Date.now());
  const dateStr = date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  // Nothing notable — short email (but still include weekly summary on Fridays)
  if (digestData.nothing_notable && !(weeklyBullets && weeklyBullets.length > 0)) {
    return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f7f7f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:24px;">
  <div style="background:#fff;border-radius:8px;padding:32px;border:1px solid #e5e5e5;">
    <p style="font-size:26px;font-weight:700;color:#1e293b;margin:0;letter-spacing:-0.5px;font-family:Georgia,'Times New Roman',serif;">Signal</p>
    <hr style="border:none;border-top:1.5px solid #1e293b;margin:14px 0 16px;">
    <p style="font-size:14px;color:#64748b;margin:0 0 20px;">${dateStr}</p>
    <p style="color:#666;font-size:15px;line-height:1.6;margin:0;">
      Scanned ${digestData.article_count || 0} articles from ${digestData.source_count || 0} sources. Nothing notable today.
    </p>
  </div>
</div>
</body>
</html>`;
  }

  // Build sections
  let sections = '';

  // Weekly review section (Fridays)
  if (weeklyBullets && weeklyBullets.length > 0) {
    sections += `
    <div style="margin-bottom:28px;padding:20px;background:#f0f7ff;border-radius:8px;border-left:4px solid #2563eb;">
      <h2 style="font-size:16px;color:#1e40af;margin:0 0 12px;">This Week</h2>
      <ul style="margin:0;padding:0 0 0 20px;color:#333;font-size:14px;line-height:1.8;">
        ${weeklyBullets.map(b => `<li>${escapeHtml(b)}</li>`).join('')}
      </ul>
    </div>`;
  }

  // Top 3 Insights
  if (digestData.top_insights && digestData.top_insights.length > 0) {
    const insightItems = digestData.top_insights.map(insight => {
      const readUrl = (insight.has_full_content && insight.article_id)
        ? `${APP_URL}/read/${insight.article_id}`
        : insight.url;
      return `
      <div style="margin-bottom:20px;padding-bottom:20px;border-bottom:1px solid #eee;">
        <h3 style="font-size:15px;color:#111;margin:0 0 6px;">${escapeHtml(insight.headline)}</h3>
        <p style="font-size:14px;color:#444;line-height:1.6;margin:0 0 6px;">${escapeHtml(insight.explanation)}</p>
        <p style="font-size:13px;color:#666;line-height:1.5;margin:0 0 4px;"><em>${escapeHtml(insight.connection)}</em></p>
        <p style="font-size:12px;color:#888;margin:0;">
          Source: ${escapeHtml(insight.source)}${readUrl ? ` &mdash; <a href="${escapeHtml(readUrl)}" style="color:#2563eb;">Read</a>` : ''}
        </p>
      </div>`;
    }).join('');

    sections += `
    <div style="margin-bottom:28px;">
      <h2 style="font-size:16px;color:#333;margin:0 0 16px;">&#127919; TOP 3 INSIGHTS</h2>
      ${insightItems}
    </div>`;
  }

  // Competitive Signals (only if they exist)
  if (digestData.competitive_signals && digestData.competitive_signals.length > 0) {
    const signalItems = digestData.competitive_signals.map(signal => `
      <div style="margin-bottom:12px;padding:12px;background:#fef9ee;border-radius:6px;">
        <p style="font-size:14px;color:#333;margin:0 0 4px;">
          <strong>${escapeHtml(signal.competitor)}</strong>: ${escapeHtml(signal.signal)}
        </p>
        <p style="font-size:13px;color:#666;margin:0;"><em>Implication: ${escapeHtml(signal.implication)}</em></p>
      </div>`).join('');

    sections += `
    <div style="margin-bottom:28px;">
      <h2 style="font-size:16px;color:#333;margin:0 0 16px;">&#128225; COMPETITIVE SIGNALS</h2>
      ${signalItems}
    </div>`;
  }

  // Worth Reading/Watching (max 5)
  if (digestData.worth_reading && digestData.worth_reading.length > 0) {
    const links = digestData.worth_reading.slice(0, 5).map(item => {
      const readUrl = (item.has_full_content && item.article_id)
        ? `${APP_URL}/read/${item.article_id}`
        : item.url;
      return `
      <li style="margin-bottom:10px;">
        <a href="${escapeHtml(readUrl)}" style="color:#2563eb;font-size:14px;text-decoration:none;font-weight:500;">${escapeHtml(item.title)}</a>
        <br><span style="font-size:13px;color:#666;">${escapeHtml(item.reason)}</span>
      </li>`;
    }).join('');

    sections += `
    <div style="margin-bottom:28px;">
      <h2 style="font-size:16px;color:#333;margin:0 0 16px;">&#128279; WORTH READING</h2>
      <ul style="margin:0;padding:0 0 0 20px;list-style:none;">
        ${links}
      </ul>
    </div>`;
  }

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f7f7f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:24px;">
  <div style="background:#fff;border-radius:8px;padding:32px;border:1px solid #e5e5e5;">
    <p style="font-size:26px;font-weight:700;color:#1e293b;margin:0;letter-spacing:-0.5px;font-family:Georgia,'Times New Roman',serif;">Signal</p>
    <hr style="border:none;border-top:1.5px solid #1e293b;margin:14px 0 16px;">
    <p style="font-size:14px;color:#64748b;margin:0 0 24px;">${weeklyBullets ? 'Weekly Review &mdash; ' : ''}${dateStr}</p>
    ${sections}
    <p style="font-size:13px;color:#999;margin:24px 0 0;padding-top:16px;border-top:1px solid #eee;text-align:center;">
      That's it. Nothing else happened worth your time today.
    </p>
  </div>
</div>
</body>
</html>`;
}

/**
 * Escape HTML entities for safe insertion into email
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Send the digest email via Resend
 * @param {Object} digestData - The digest object
 * @param {Array|null} weeklyBullets - Optional weekly summary (Fridays)
 * @returns {Promise<{status: string, id?: string, error?: any}>}
 */
export async function sendDigestEmail(digestData, weeklyBullets = null) {
  const to = process.env.DIGEST_EMAIL;
  if (!to) {
    console.error('[Email] DIGEST_EMAIL not set, skipping send');
    return { status: 'failed', error: 'DIGEST_EMAIL not configured' };
  }

  if (!process.env.RESEND_API_KEY) {
    console.error('[Email] RESEND_API_KEY not set, skipping send');
    return { status: 'failed', error: 'RESEND_API_KEY not configured' };
  }

  const date = new Date(digestData.date || Date.now());
  const dateStr = date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  const subject = weeklyBullets
    ? `Weekly Review + Signal \u2014 ${dateStr}`
    : `Signal \u2014 ${dateStr}`;

  const html = buildDigestHtml(digestData, weeklyBullets);

  // Attempt send with one retry
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const result = await getResend().emails.send({
        from: FROM_ADDRESS,
        to,
        subject,
        html,
      });

      console.log(`[Email] Sent digest to ${to} (id: ${result.data?.id})`);
      return { status: 'sent', id: result.data?.id };
    } catch (error) {
      console.error(`[Email] Send failed (attempt ${attempt}/2):`, error.message);

      if (attempt === 1) {
        console.log('[Email] Retrying in 60 seconds...');
        await new Promise(r => setTimeout(r, 60000));
      } else {
        // Log full digest so data isn't lost
        console.log('[Email] FULL DIGEST (email failed):');
        console.log(JSON.stringify(digestData, null, 2));
        return { status: 'failed', error: error.message };
      }
    }
  }
}
