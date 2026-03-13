import fs from "fs";
import { google } from "googleapis";

const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);

const CLIENT_ID = credentials.installed.client_id;
const CLIENT_SECRET = credentials.installed.client_secret;

const REFRESH_TOKEN = process.env.YOUTUBE_REFRESH_TOKEN;

const PENDING_FOLDER_ID = process.env.PENDING_FOLDER_ID;
const SCHEDULED_FOLDER_ID = process.env.SCHEDULED_FOLDER_ID;

/*
Uploads per run
*/
const MAX_UPLOADS_PER_RUN = 4;

/*
IST offset
*/
const IST_OFFSET = 5.5 * 60 * 60 * 1000;

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

/*
Posting slots (IST)
*/
const SLOTS = [
  { h: 10, m: 0 },
  { h: 16, m: 0 },
  { h: 18, m: 0 },
  { h: 20, m: 0 }
];

/*
Title variations for Shorts
*/
const TITLE_VARIATIONS = [
  "Insane Clash Royale Finish",
  "Epic Clash Royale Clutch",
  "Crazy Clash Royale Comeback",
  "Clash Royale Pro Gameplay",
  "Unbelievable Clash Royale Moment",
  "Clash Royale Insane Push",
  "Clash Royale Final Seconds Win",
  "Clash Royale Intense Battle",
  "Pro Level Clash Royale Gameplay",
  "Clash Royale Perfect Counter",
  "Clash Royale Unexpected Victory",
  "Clash Royale Ultimate Defense",
  "Clash Royale Close Match",
  "Clash Royale Epic Tower Finish",
  "Clash Royale Last Second Clutch"
];

/*
Generate IST scheduling slots
*/
function generateScheduleSlots(count){

  const slots = [];

  const now = new Date();

  const istNow = new Date(now.getTime() + IST_OFFSET);

  const start = new Date(istNow);

  start.setDate(start.getDate() + 1);
  start.setHours(0);
  start.setMinutes(0);
  start.setSeconds(0);

  let day = 0;

  while(slots.length < count){

    for(const s of SLOTS){

      const d = new Date(start);

      d.setDate(start.getDate() + day);
      d.setHours(s.h);
      d.setMinutes(s.m);
      d.setSeconds(0);

      const utcTime = new Date(d.getTime() - IST_OFFSET);

      slots.push(utcTime);

      if(slots.length >= count) break;

    }

    day++;

  }

  return slots;

}

/*
Random title generator
*/
function generateTitle(){

  const index = Math.floor(Math.random() * TITLE_VARIATIONS.length);

  const base = TITLE_VARIATIONS[index];

  return `${base} 🔥 #shorts #clashroyale`;

}

/*
Description generator
*/
function generateDescription(title){

return `${title}

Subscribe for daily Clash Royale gameplay!

🔥 Daily Shorts
🔥 Epic Gameplay
🔥 Pro Moments

#shorts
#clashroyale
#gaming
#mobilegaming`;

}

/*
Get pending videos
*/
async function getPendingVideos(){

  const res = await drive.files.list({

    q: `'${PENDING_FOLDER_ID}' in parents and mimeType contains 'video/' and trashed=false`,
    fields: "files(id,name)",
    spaces: "drive"

  });

  return res.data.files.sort((a,b)=>a.name.localeCompare(b.name));

}

/*
Download file
*/
async function downloadFile(fileId,name){

  const path = `/tmp/${name}`;

  const dest = fs.createWriteStream(path);

  const res = await drive.files.get(
    { fileId, alt:"media" },
    { responseType:"stream" }
  );

  await new Promise((resolve,reject)=>{

    res.data.pipe(dest)
      .on("finish",resolve)
      .on("error",reject);

  });

  return path;

}

/*
Upload video to YouTube
*/
async function uploadToYoutube(filePath,publishTime){

  const title = generateTitle();

  console.log("Using title:",title);

  const res = await youtube.videos.insert({

    part:"snippet,status",

    requestBody:{

      snippet:{
        title:title,
        description:generateDescription(title),
        tags:[
          "shorts",
          "clashroyale",
          "gaming",
          "mobilegaming",
          "clash royale gameplay"
        ]
      },

      status:{
        privacyStatus:"private",
        publishAt:publishTime.toISOString()
      }

    },

    media:{
      body:fs.createReadStream(filePath)
    }

  });

  return res.data.id;

}

/*
Move video after scheduling
*/
async function moveFile(fileId){

  await drive.files.update({

    fileId,
    addParents:SCHEDULED_FOLDER_ID,
    removeParents:PENDING_FOLDER_ID

  });

}

/*
Main scheduler
*/
async function run(){

  console.log("Checking pending videos...");

  const files = await getPendingVideos();

  if(!files.length){

    console.log("No pending videos.");
    return;

  }

  const batch = files.slice(0,MAX_UPLOADS_PER_RUN);

  const slots = generateScheduleSlots(batch.length);

  console.log(`Scheduling ${batch.length} videos`);

  for(let i=0;i<batch.length;i++){

    const video = batch[i];

    const slot = slots[i];

    console.log("Processing:",video.name);

    const path = await downloadFile(video.id,video.name);

    console.log("Scheduling for:",slot);

    const id = await uploadToYoutube(
      path,
      slot
    );

    console.log("Uploaded:",id);

    await moveFile(video.id);

    console.log("Moved to SCHEDULED");

  }

}

run().catch(err=>{
  console.error(err);
  process.exit(1);
});
