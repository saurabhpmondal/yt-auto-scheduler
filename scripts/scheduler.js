import fs from "fs";
import path from "path";
import dayjs from "dayjs";
import { google } from "googleapis";

const SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/youtube.upload"
];

const auth = new google.auth.GoogleAuth({
  keyFile: "credentials.json",
  scopes: SCOPES
});

const drive = google.drive({ version: "v3", auth });
const youtube = google.youtube({ version: "v3", auth });

const PENDING_FOLDER = process.env.PENDING_FOLDER_ID;
const SCHEDULED_FOLDER = process.env.SCHEDULED_FOLDER_ID;

const slots = ["10:00", "16:00", "18:00", "20:00"];

function getNextSlot() {

  const now = dayjs();
  const today = now.format("YYYY-MM-DD");

  for (let time of slots) {

    const slot = dayjs(`${today} ${time}`);

    if (slot.isAfter(now)) {
      return slot;
    }
  }

  const tomorrow = now.add(1, "day").format("YYYY-MM-DD");

  return dayjs(`${tomorrow} ${slots[0]}`);
}

async function getPendingVideos() {

  const res = await drive.files.list({
    q: `'${PENDING_FOLDER}' in parents and mimeType contains 'video/'`,
    fields: "files(id,name)"
  });

  return res.data.files;
}

async function downloadFile(fileId, name) {

  const filePath = path.join("/tmp", name);
  const dest = fs.createWriteStream(filePath);

  const res = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "stream" }
  );

  await new Promise((resolve, reject) => {

    res.data
      .pipe(dest)
      .on("finish", resolve)
      .on("error", reject);

  });

  return filePath;
}

async function uploadToYoutube(filePath, title, publishTime) {

  const response = await youtube.videos.insert({
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

  return response.data.id;
}

async function moveFile(fileId) {

  await drive.files.update({
    fileId: fileId,
    addParents: SCHEDULED_FOLDER,
    removeParents: PENDING_FOLDER
  });
}

async function run() {

  const files = await getPendingVideos();

  if (files.length === 0) {
    console.log("No pending videos");
    return;
  }

  const file = files[0];

  console.log("Processing:", file.name);

  const filePath = await downloadFile(file.id, file.name);

  const publishTime = getNextSlot();

  const videoId = await uploadToYoutube(
    filePath,
    file.name,
    publishTime
  );

  console.log("Uploaded video:", videoId);

  await moveFile(file.id);

  console.log("Moved file to scheduled folder");
}

run();
