import { getAuth, signInWithPopup, GoogleAuthProvider, User } from 'firebase/auth';
import { app } from './firebase';
import { Attendee } from '../types';

const auth = getAuth(app);
const provider = new GoogleAuthProvider();

// Add Gmail sending and userinfo scopes
provider.addScope('https://www.googleapis.com/auth/gmail.send');
provider.addScope('https://www.googleapis.com/auth/userinfo.email');
provider.addScope('https://www.googleapis.com/auth/userinfo.profile');

let cachedAccessToken: string | null = null;
let cachedUser: User | null = null;

// Handle sign-in to retrieve OAuth Access Token
export async function googleSignInForGmail(): Promise<{ user: User; accessToken: string }> {
  try {
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('No access token returned from Google authentication.');
    }
    cachedAccessToken = credential.accessToken;
    cachedUser = result.user;
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error) {
    console.error('Google Sign-In failed', error);
    throw error;
  }
}

export function getCachedGmailUser() {
  return { user: cachedUser, token: cachedAccessToken };
}

export function gmailSignOut() {
  cachedAccessToken = null;
  cachedUser = null;
}

// Encodes raw string safely for Gmail's rfc822 base64url requirement
function base64UrlSafe(str: string): string {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

interface SendEmailParams {
  recipientEmail: string;
  eventName: string;
  eventDate: string;
  creatorName?: string | null;
  attendees: Attendee[];
  pdfBase64: string;
}

export async function sendAttendanceEmail({
  recipientEmail,
  eventName,
  eventDate,
  creatorName,
  attendees,
  pdfBase64
}: SendEmailParams): Promise<any> {
  const token = cachedAccessToken;
  if (!token) {
    throw new Error('Authentication required before sending emails.');
  }

  // Pre-calculate duplicates
  const deviceCounts: { [key: string]: number } = {};
  attendees.forEach(att => {
    if (att.deviceId) {
      deviceCounts[att.deviceId] = (deviceCounts[att.deviceId] || 0) + 1;
    }
  });

  const formattedDate = new Date(eventDate).toLocaleString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  // Construct structured rich email HTML body
  const htmlBody = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #f3f4f6; border-radius: 16px; background-color: #ffffff; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
      <div style="text-align: center; margin-bottom: 24px;">
        <h2 style="color: #4f46e5; margin: 0; font-size: 22px; font-weight: 700;">Attendance Report</h2>
        <p style="color: #6b7280; font-size: 14px; margin: 4px 0 0 0;">Online Attendance Tracker</p>
      </div>
      
      <div style="background-color: #f9fafb; padding: 18px; border-radius: 12px; margin-bottom: 24px; border: 1px solid #f3f4f6;">
        <h3 style="margin-top: 0; color: #111827; font-size: 15px; font-weight: 600; margin-bottom: 12px;">Event Information</h3>
        <table style="width: 100%; border-collapse: collapse; font-size: 13px; line-height: 1.5;">
          <tr>
            <td style="color: #6b7280; padding: 4px 0; width: 120px; vertical-align: top;">Event Name:</td>
            <td style="color: #111827; font-weight: 600; padding: 4px 0; vertical-align: top;">${eventName}</td>
          </tr>
          <tr>
            <td style="color: #6b7280; padding: 4px 0; vertical-align: top;">Created On:</td>
            <td style="color: #111827; padding: 4px 0; vertical-align: top;">${formattedDate}</td>
          </tr>
          ${creatorName ? `
          <tr>
            <td style="color: #6b7280; padding: 4px 0; vertical-align: top;">Host/Instructor:</td>
            <td style="color: #111827; padding: 4px 0; vertical-align: top;">${creatorName}</td>
          </tr>` : ''}
          <tr>
            <td style="color: #6b7280; padding: 4px 0; vertical-align: top;">Total Sign-ins:</td>
            <td style="color: #111827; font-weight: 600; padding: 4px 0; vertical-align: top;">${attendees.length}</td>
          </tr>
        </table>
      </div>
      
      <h3 style="color: #111827; font-size: 15px; font-weight: 600; border-bottom: 1px solid #e5e7eb; padding-bottom: 8px; margin-bottom: 12px;">Attendees List Summary</h3>
      <table style="width: 100%; border-collapse: collapse; font-size: 12px; line-height: 1.5; margin-bottom: 24px;">
        <thead>
          <tr style="background-color: #f9fafb; border-bottom: 1px solid #f3f4f6;">
            <th style="padding: 10px 8px; text-align: left; color: #4b5563; font-weight: 600;">#</th>
            <th style="padding: 10px 8px; text-align: left; color: #4b5563; font-weight: 600;">Name</th>
            <th style="padding: 10px 8px; text-align: left; color: #4b5563; font-weight: 600;">Time of Join</th>
          </tr>
        </thead>
        <tbody>
          ${attendees.map((att, idx) => {
            const isDuplicate = att.deviceId && deviceCounts[att.deviceId] > 1;
            const joinTime = new Date(att.joinedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            return `
              <tr style="border-bottom: 1px solid #f3f4f6;">
                <td style="padding: 10px 8px; color: #9ca3af;">${idx + 1}</td>
                <td style="padding: 10px 8px; font-weight: 500; color: #111827;">
                  ${att.name}
                  ${isDuplicate ? `
                    <span style="display: inline-block; color: #dc2626; font-size: 10px; background-color: #fef2f2; border: 1px solid #fee2e2; padding: 1px 4px; border-radius: 4px; font-weight: 500; margin-left: 4px;">
                      Shared Phone
                    </span>
                  ` : ''}
                </td>
                <td style="padding: 10px 8px; color: #4b5563;">${joinTime}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
      
      <p style="font-size: 12px; color: #9ca3af; text-align: center; margin: 24px 0 0 0; padding-top: 16px; border-top: 1px solid #f3f4f6;">
        This is an automated attendance report. The full official PDF export is attached.
      </p>
    </div>
  `.trim();

  const sanitizedEventName = eventName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const attachmentFileName = `attendance_${sanitizedEventName}.pdf`;
  const boundary = `====_Boundary_Boundary_====`;

  // Construct raw MIME content with base64 encoded parts
  const mimeParts = [
    `To: ${recipientEmail}`,
    `Subject: Attendance Report - ${eventName}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset="UTF-8"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    btoa(unescape(encodeURIComponent(htmlBody))),
    ``,
    `--${boundary}`,
    `Content-Type: application/pdf; name="${attachmentFileName}"`,
    `Content-Disposition: attachment; filename="${attachmentFileName}"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    pdfBase64,
    ``,
    `--${boundary}--`
  ];

  const rawMime = mimeParts.join('\r\n');
  const base64MimeUrlSafe = base64UrlSafe(rawMime);

  // Send request via Gmail API
  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      raw: base64MimeUrlSafe
    })
  });

  if (!response.ok) {
    const errorDetails = await response.json().catch(() => ({}));
    console.error('Gmail send API error details:', errorDetails);
    throw new Error(`Gmail API failed to send: ${response.statusText}`);
  }

  return response.json();
}
