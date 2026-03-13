import fs from "fs";
import { google } from "googleapis";

const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);

const CLIENT_ID = credentials.installed.client_id;
const CLIENT_SECRET = credentials.installed.client_secret;

const REFRESH_TOKEN = process.env.YOUTUBE_REFRESH_TOKEN;

const PENDING_FOLDER_ID = process.env.PENDING_FOLDER_ID;
const SCHEDULED_FOLDER_ID = process.env.SCHEDULED_FOLDER_ID;

const MAX_UPLOADS_PER_RUN = 4;

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

const SLOTS = [
  { h: 10, m: 0 },
  { h: 16, m: 0 },
  { h: 18, m: 0 },
  { h: 20, m: 0 }
];

const TITLE_VARIATIONS = [
  "WATCH TILL THE END 🔥",
  "THIS WAS INSANE 🤯",
  "NO WAY THIS WORKED",
  "CLUTCH MOMENT",
  "UNBELIEVABLE FINISH"
];

const GAMEPLAY_TITLES = [
  "Clash Royale Comeback",
  "Clash Royale Epic Gameplay",
  "Clash Royale Clutch Moment",
  "Clash Royale Pro Strategy"
];

function rand(min,max){
  return Math.floor(Math.random()*(max-min+1))+min;
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
#gaming`;
}

/*
READ LAST SCHEDULE DATE
*/
function getLastScheduleDate(){

  const data = JSON.parse(fs.readFileSync("last_schedule_date.json"));

  return new Date(data.last_date);

}

/*
SAVE NEXT DATE
*/
function updateLastScheduleDate(nextDate){

  const obj = {
    last_date: nextDate.toISOString().split("T")[0]
  };

  fs.writeFileSync(
    "last_schedule_date.json",
    JSON.stringify(obj,null,2)
  );

}

/*
GENERATE SLOTS
*/
function generateScheduleSlots(baseDate){

  const slots=[];

  for(const slot of SLOTS){

    const d=new Date(baseDate);

    d.setHours(slot.h);
    d.setMinutes(slot.m);
    d.setSeconds(0);

    const utc=new Date(d.getTime()-IST_OFFSET);

    slots.push(utc);

  }

  return slots;

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

  const path=`/tmp/${name}`;

  const dest=fs.createWriteStream(path);

  const res=await drive.files.get(
    {fileId,alt:"media"},
    {responseType:"stream"}
  );

  await new Promise((resolve,reject)=>{
    res.data.pipe(dest)
    .on("finish",resolve)
    .on("error",reject);
  });

  return path;

}

async function uploadToYoutube(filePath,publishTime){

  const title=generateTitle();

  console.log("Title:",title);

  const res=await youtube.videos.insert({

    part:"snippet,status",

    requestBody:{
      snippet:{
        title:title,
        description:generateDescription(title),
        tags:["shorts","clashroyale","gaming"]
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

/*
DASHBOARD STATUS WRITER
*/
function updateDashboardStatus(pendingCount, processedCount){

  const lastSchedule = JSON.parse(fs.readFileSync("last_schedule_date.json"));

  const status = {
    last_run: new Date().toISOString(),
    pending_videos: pendingCount,
    uploaded_this_run: processedCount,
    total_processed_this_run: processedCount,
    last_schedule_date: lastSchedule.last_date
  };

  fs.writeFileSync(
    "scheduler-status.json",
    JSON.stringify(status,null,2)
  );

}

async function run(){

  console.log("Checking pending videos...");

  const files=await getPendingVideos();

  const totalPending=files.length;

  if(!files.length){
    console.log("No pending videos.");

    updateDashboardStatus(0,0);

    return;
  }

  const batch=files.slice(0,MAX_UPLOADS_PER_RUN);

  const baseDate=getLastScheduleDate();

  const slots=generateScheduleSlots(baseDate);

  let processed=0;

  for(let i=0;i<batch.length;i++){

    const video=batch[i];
    const slot=slots[i];

    console.log("Processing:",video.name);

    const path=await downloadFile(video.id,video.name);

    console.log("Scheduling for:",slot);

    const id=await uploadToYoutube(path,slot);

    console.log("Uploaded:",id);

    await moveFile(video.id);

    processed++;

  }

  const nextDate=new Date(baseDate);
  nextDate.setDate(nextDate.getDate()+1);

  updateLastScheduleDate(nextDate);

  const remaining = totalPending - processed;

  updateDashboardStatus(remaining, processed);

}

run().catch(err=>{
  console.error(err);
  process.exit(1);
});
