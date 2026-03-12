import fs from "fs";
import { google } from "googleapis";

const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);

const CLIENT_ID = credentials.installed.client_id;
const CLIENT_SECRET = credentials.installed.client_secret;

const REFRESH_TOKEN = process.env.YOUTUBE_REFRESH_TOKEN;

const PENDING_FOLDER_ID = process.env.PENDING_FOLDER_ID;
const SCHEDULED_FOLDER_ID = process.env.SCHEDULED_FOLDER_ID;

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  "http://localhost"
);

oauth2Client.setCredentials({
  refresh_token: REFRESH_TOKEN
});

const youtube = google.youtube({
  version: "v3",
  auth: oauth2Client
});

const drive = google.drive({
  version: "v3",
  auth: oauth2Client
});

const SLOTS = [
  { h: 10, m: 0 },
  { h: 16, m: 0 },
  { h: 18, m: 0 },
  { h: 20, m: 0 }
];

function getNextSlot() {

  const now = new Date();

  for (const slot of SLOTS) {

    const d = new Date();

    d.setHours(slot.h);
    d.setMinutes(slot.m);
    d.setSeconds(0);

    if (d > now) return d;
  }

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  tomorrow.setHours(SLOTS[0].h);
  tomorrow.setMinutes(SLOTS[0].m);
  tomorrow.setSeconds(0);

  return tomorrow;
}

async function getPendingVideos() {

  const res = await drive.files.list({
    q: `'${PENDING_FOLDER_ID}' in parents and mimeType contains 'video/' and trashed=false`,
    fields: "files(id,name)",
    spaces: "drive"
  });

  return res.data.files;
}

async function downloadFile(fileId, name) {

  const filePath = `/tmp/${name}`;
  const dest = fs.createWriteStream(filePath);

  const res = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "stream" }
  );

  await new Promise((resolve, reject) => {
    res.data.pipe(dest).on("finish", resolve).on("error", reject);
  });

  return filePath;
}

async function uploadToYoutube(filePath, title, publishTime) {

  const res = await youtube.videos.insert({

    part: "snippet,status",

    requestBody: {

      snippet: {
        title: title,
        description: "Auto uploaded",
        tags: ["shorts"]
      },

      status: {
        privacyStatus: "private",
        publishAt: publishTime.toISOString()
      }

    },

    media: {
      body: fs.createReadStream(filePath)
    }

  });

  return res.data.id;
}

async function moveFile(fileId) {

  await drive.files.update({
    fileId: fileId,
    addParents: SCHEDULED_FOLDER_ID,
    removeParents: PENDING_FOLDER_ID
  });

}

async function run() {

  console.log("Checking pending videos...");

  const files = await getPendingVideos();

  if (!files.length) {
    console.log("No pending videos.");
    return;
  }

  const video = files[0];

  console.log("Processing:", video.name);

  const filePath = await downloadFile(video.id, video.name);

  const publishTime = getNextSlot();

  console.log("Scheduling for:", publishTime);

  const videoId = await uploadToYoutube(
    filePath,
    video.name,
    publishTime
  );

  console.log("Uploaded video:", videoId);

  await moveFile(video.id);

  console.log("Moved file to SCHEDULED folder");

}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
