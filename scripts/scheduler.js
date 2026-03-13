import fs from "fs";
import { google } from "googleapis";

const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);

const CLIENT_ID = credentials.installed.client_id;
const CLIENT_SECRET = credentials.installed.client_secret;

const REFRESH_TOKEN = process.env.YOUTUBE_REFRESH_TOKEN;

const PENDING_FOLDER_ID = process.env.PENDING_FOLDER_ID;
const SCHEDULED_FOLDER_ID = process.env.SCHEDULED_FOLDER_ID;

const MAX_UPLOADS_PER_RUN = 4;
const MAX_UPLOADS_PER_DAY = 4;

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
Posting slots IST
*/
const SLOTS = [
  { h: 10, m: 0 },
  { h: 16, m: 0 },
  { h: 18, m: 0 },
  { h: 20, m: 0 }
];

/*
Titles
*/
const TITLE_VARIATIONS = [
  "WATCH TILL THE END 🔥",
  "THIS WAS INSANE 🤯",
  "1 HP LEFT 😳",
  "NO WAY THIS WORKED",
  "CLUTCH MOMENT",
  "UNBELIEVABLE FINISH"
];

const GAMEPLAY_TITLES = [
  "Clash Royale Comeback",
  "Clash Royale Epic Gameplay",
  "Clash Royale Clutch Moment",
  "Clash Royale Pro Strategy",
  "Clash Royale Final Tower Finish"
];

function rand(min,max){
  return Math.floor(Math.random()*(max-min+1))+min;
}

/*
Get IST date string
*/
function getISTDate(){

  const now = new Date();
  const ist = new Date(now.getTime() + IST_OFFSET);

  return ist.toISOString().split("T")[0];

}

/*
Read daily upload tracker
*/
function getDailyUploads(){

  const today = getISTDate();

  if(!fs.existsSync("daily-limit.json")){

    const data = {
      date: today,
      uploads: 0
    };

    fs.writeFileSync(
      "daily-limit.json",
      JSON.stringify(data,null,2)
    );

    return data;

  }

  const data = JSON.parse(
    fs.readFileSync("daily-limit.json")
  );

  if(data.date !== today){

    const reset = {
      date: today,
      uploads: 0
    };

    fs.writeFileSync(
      "daily-limit.json",
      JSON.stringify(reset,null,2)
    );

    return reset;

  }

  return data;

}

/*
Update daily uploads
*/
function updateDailyUploads(count){

  const today = getISTDate();

  const data = {
    date: today,
    uploads: count
  };

  fs.writeFileSync(
    "daily-limit.json",
    JSON.stringify(data,null,2)
  );

}

/*
Generate schedule slots
*/
function generateScheduleSlots(count){

  const slots = [];

  const now = new Date();
  const istNow = new Date(now.getTime() + IST_OFFSET);

  let dayOffset = 1;

  while(slots.length < count){

    for(const s of SLOTS){

      const base = new Date(istNow);

      base.setDate(istNow.getDate() + dayOffset);

      base.setHours(s.h);
      base.setMinutes(s.m + rand(-12,12));
      base.setSeconds(rand(0,40));

      const utc = new Date(base.getTime() - IST_OFFSET);

      slots.push(utc);

      if(slots.length >= count) break;

    }

    dayOffset++;

  }

  return slots;

}

function generateTitle(){

  const hook = TITLE_VARIATIONS[rand(0,TITLE_VARIATIONS.length-1)];
  const gameplay = GAMEPLAY_TITLES[rand(0,GAMEPLAY_TITLES.length-1)];

  return `${hook} ${gameplay} #shorts`;

}

function generateDescription(title){

return `${title}

Subscribe for daily Clash Royale gameplay!

#shorts
#clashroyale
#gaming
#mobilegaming`;

}

async function getPendingVideos(){

  const res = await drive.files.list({
    q: `'${PENDING_FOLDER_ID}' in parents and mimeType contains 'video/' and trashed=false`,
    fields: "files(id,name)",
    spaces: "drive"
  });

  return res.data.files.sort((a,b)=>a.name.localeCompare(b.name));

}

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

async function uploadToYoutube(filePath,publishTime){

  const title = generateTitle();

  console.log("Title:",title);

  const res = await youtube.videos.insert({

    part:"snippet,status",

    requestBody:{

      snippet:{
        title:title,
        description:generateDescription(title),
        tags:["shorts","clashroyale","gaming","mobilegaming"]
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

async function moveFile(fileId){

  await drive.files.update({
    fileId,
    addParents:SCHEDULED_FOLDER_ID,
    removeParents:PENDING_FOLDER_ID
  });

}

function writeDashboardStatus(pending,uploaded){

  const status = {

    last_run:new Date().toISOString(),
    pending_videos:pending,
    uploaded_this_run:uploaded,
    total_processed_this_run:uploaded

  };

  fs.writeFileSync(
    "scheduler-status.json",
    JSON.stringify(status,null,2)
  );

}

async function run(){

  console.log("Checking pending videos...");

  const daily = getDailyUploads();

  if(daily.uploads >= MAX_UPLOADS_PER_DAY){

    console.log("Daily upload limit reached.");

    writeDashboardStatus(0,0);

    return;

  }

  const files = await getPendingVideos();

  const pendingCount = files.length;

  if(!files.length){

    writeDashboardStatus(0,0);
    return;

  }

  const remainingToday = MAX_UPLOADS_PER_DAY - daily.uploads;

  const batchSize = Math.min(
    MAX_UPLOADS_PER_RUN,
    remainingToday,
    files.length
  );

  const batch = files.slice(0,batchSize);

  const slots = generateScheduleSlots(batch.length);

  let uploadedCount = 0;

  for(let i=0;i<batch.length;i++){

    const video = batch[i];
    const slot = slots[i];

    console.log("Processing:",video.name);

    const path = await downloadFile(video.id,video.name);

    console.log("Scheduling for:",slot);

    const id = await uploadToYoutube(path,slot);

    console.log("Uploaded:",id);

    await moveFile(video.id);

    uploadedCount++;

  }

  updateDailyUploads(daily.uploads + uploadedCount);

  writeDashboardStatus(
    pendingCount - uploadedCount,
    uploadedCount
  );

}

run().catch(err=>{
  console.error(err);
  process.exit(1);
});
