import fs from "fs";
import { google } from "googleapis";

const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);

const CLIENT_ID = credentials.installed.client_id;
const CLIENT_SECRET = credentials.installed.client_secret;

const REFRESH_TOKEN = process.env.YOUTUBE_REFRESH_TOKEN;

const PENDING_FOLDER_ID = process.env.PENDING_FOLDER_ID;
const SCHEDULED_FOLDER_ID = process.env.SCHEDULED_FOLDER_ID;

/*
Safe upload count per run.
YouTube quota ≈ 6 uploads/day default
We keep it 4 to stay safe.
*/
const MAX_UPLOADS_PER_RUN = 4;

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

function generateScheduleSlots(count) {

  const slots = [];

  const start = new Date();

  // Start scheduling from tomorrow
  start.setDate(start.getDate() + 1);
  start.setHours(10);
  start.setMinutes(0);
  start.setSeconds(0);

  let day = 0;

  while (slots.length < count) {

    for (const s of SLOTS) {

      const d = new Date(start);

      d.setDate(start.getDate() + day);
      d.setHours(s.h);
      d.setMinutes(s.m);

      slots.push(new Date(d));

      if (slots.length >= count) break;
    }

    day++;
  }

  return slots;
}

/*
Clean video filename into better YouTube title
*/
function generateTitle(filename){

  const clean = filename
    .replace(".mp4","")
    .replace(/\(\d+\)/,"")
    .replace(/_/g," ")
    .trim();

  return `${clean} #shorts #clashroyale #gaming`;
}

/*
Auto description
*/
function generateDescription(title){

return `${title}

Subscribe for daily Clash Royale gameplay!

#shorts
#clashroyale
#mobilegaming
#gaming`;
}

async function getPendingVideos() {

  const res = await drive.files.list({
    q: `'${PENDING_FOLDER_ID}' in parents and mimeType contains 'video/' and trashed=false`,
    fields: "files(id,name)",
    spaces: "drive"
  });

  // Sort videos by name for consistent ordering
  return res.data.files.sort((a,b)=>a.name.localeCompare(b.name));
}

async function downloadFile(fileId, name) {

  const path = `/tmp/${name}`;

  const dest = fs.createWriteStream(path);

  const res = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "stream" }
  );

  await new Promise((resolve, reject) => {
    res.data.pipe(dest).on("finish", resolve).on("error", reject);
  });

  return path;
}

async function uploadToYoutube(filePath, filename, publishTime) {

  const title = generateTitle(filename);

  const res = await youtube.videos.insert({

    part: "snippet,status",

    requestBody: {

      snippet: {
        title: title,
        description: generateDescription(title),
        tags: ["shorts","clashroyale","gaming"]
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
    fileId,
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

  const batch = files.slice(0, MAX_UPLOADS_PER_RUN);

  const slots = generateScheduleSlots(batch.length);

  console.log(`Scheduling ${batch.length} videos`);

  for (let i = 0; i < batch.length; i++) {

    const video = batch[i];

    const slot = slots[i];

    console.log("Processing:", video.name);

    const path = await downloadFile(video.id, video.name);

    console.log("Scheduling for:", slot);

    const id = await uploadToYoutube(
      path,
      video.name,
      slot
    );

    console.log("Uploaded:", id);

    await moveFile(video.id);

    console.log("Moved to SCHEDULED");

  }

}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
