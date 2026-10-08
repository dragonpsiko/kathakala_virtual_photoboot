const video = document.getElementById('webcam');
const canvas = document.getElementById('canvas');
const photoResult = document.getElementById('photo-result');
const downloadLink = document.getElementById('download-link');

const selectionScreen = document.getElementById('selection-screen');
const boothScreen = document.getElementById('booth-screen');
const resultScreen = document.getElementById('result-screen');
const uploadStatus = document.getElementById('upload-status');
const timerOverlay = document.getElementById('timer-overlay');
const timerNumber = document.getElementById('timer-number');
const poseIndicator = document.getElementById('pose-indicator');
const btnStart = document.getElementById('btn-start');
const btnFlip = document.getElementById('btn-flip');
const flashEl = document.getElementById('flash');

const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzKzgjeXSZo1l7q1hGmHs7kwQSEJulvpVIOYmhvbi4drJClS0o6C_0X2sDrIkBRsCrP_A/exec";

let currentStream = null;
let facingMode = "user";
let capturedPoses = [];
let selectedFrameKey = "boarding_pass";
let activeFilter = "normal";
let activeFrameImg = new Image();

// Cache & Loader untuk Hald CLUT LUT (Fuji Astia)
const lutCache = {};

function loadLUT(lutName, src) {
  return new Promise((resolve, reject) => {
    if (lutCache[lutName]) return resolve(lutCache[lutName]);

    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.src = src;
    img.onload = () => {
      const lutCanvas = document.createElement('canvas');
      lutCanvas.width = img.width;
      lutCanvas.height = img.height;
      const lutCtx = lutCanvas.getContext('2d');
      lutCtx.drawImage(img, 0, 0);

      lutCache[lutName] = {
        data: lutCtx.getImageData(0, 0, img.width, img.height).data,
        size: Math.round(Math.pow(img.width * img.height, 1/3))
      };
      resolve(lutCache[lutName]);
    };
    img.onerror = err => reject(err);
  });
}

// Preload LUT Fujifilm Astia
loadLUT('fuji_astia', 'assets/luts/fuji_astia.png');

function selectFrame(key, cardElement) {
  selectedFrameKey = key;
  document.querySelectorAll('.frame-card').forEach(card => card.classList.remove('selected'));
  cardElement.classList.add('selected');
}

function setFilter(filterType, btnElement) {
  activeFilter = filterType;
  document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
  btnElement.classList.add('active');

  video.className = `filter-${filterType}`;
}

function goToBooth() {
  const config = FRAME_CONFIGS[selectedFrameKey];
  activeFrameImg.src = config.src;
  
  selectionScreen.style.display = "none";
  boothScreen.style.display = "flex";
  startCamera();
}

function backToSelection() {
  if (currentStream) {
    currentStream.getTracks().forEach(track => track.stop());
  }
  boothScreen.style.display = "none";
  selectionScreen.style.display = "flex";
}

async function startCamera() {
  if (currentStream) {
    currentStream.getTracks().forEach(track => track.stop());
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { 
        facingMode: facingMode, 
        width: { ideal: 1280 },
        height: { ideal: 960 }
      },
      audio: false
    });
    currentStream = stream;
    video.srcObject = stream;
  } catch (err) {
    alert("Akses kamera ditolak atau tidak didukung.");
    console.error(err);
  }
}

function switchCamera() {
  facingMode = facingMode === "user" ? "environment" : "user";
  video.style.transform = facingMode === "user" ? "scaleX(-1)" : "scaleX(1)";
  startCamera();
}

async function triggerFlash() {
  flashEl.classList.add('active');
  await delay(150);
  flashEl.classList.remove('active');
}

async function startMultiPoseSession() {
  capturedPoses = [];
  btnStart.disabled = true;
  btnFlip.disabled = true;
  timerOverlay.style.display = "flex";

  const config = FRAME_CONFIGS[selectedFrameKey];

  for (let poseIndex = 1; poseIndex <= config.posesCount; poseIndex++) {
    poseIndicator.innerText = `Pose ${poseIndex} dari ${config.posesCount}`;
    
    for (let count = 3; count > 0; count--) {
      timerNumber.innerText = count;
      await delay(1000);
    }

    timerNumber.innerText = "📸";
    await triggerFlash();
    captureSingleFrame();

    if (poseIndex < config.posesCount) {
      poseIndicator.innerText = "Ganti Pose Berikutnya!";
      await delay(1200);
    }
  }

  timerOverlay.style.display = "none";
  btnStart.disabled = false;
  btnFlip.disabled = false;

  compileFinalImage();
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function captureSingleFrame() {
  const tempCanvas = document.createElement('canvas');
  const tempCtx = tempCanvas.getContext('2d');
  
  tempCanvas.width = video.videoWidth;
  tempCanvas.height = video.videoHeight;

  // Terapkan efek filter saat penangkapan gambar
  if (activeFilter === 'beauty') {
    tempCtx.filter = 'brightness(1.12) contrast(0.98) saturate(1.08) sepia(0.05)';
  } else if (activeFilter === 'radiant') {
    tempCtx.filter = 'brightness(1.15) contrast(1.02) saturate(1.15) hue-rotate(-5deg)';
  } else if (activeFilter === 'bw') {
    tempCtx.filter = 'grayscale(100%) contrast(120%)';
  } else if (activeFilter === 'vintage') {
    tempCtx.filter = 'sepia(50%) contrast(105%) brightness(95%)';
  } else if (activeFilter === 'bright') {
    tempCtx.filter = 'brightness(115%) contrast(105%)';
  } else if (activeFilter === 'y2k') {
    tempCtx.filter = 'saturate(160%) contrast(125%)';
  } else {
    tempCtx.filter = 'none';
  }

  if (facingMode === "user") {
    tempCtx.translate(tempCanvas.width, 0);
    tempCtx.scale(-1, 1);
  }

  tempCtx.drawImage(video, 0, 0);
  capturedPoses.push(tempCanvas);
}

function applyHaldLUT(targetCanvas, lutName) {
  const lut = lutCache[lutName];
  if (!lut) return;

  const ctx = targetCanvas.getContext('2d');
  const imgData = ctx.getImageData(0, 0, targetCanvas.width, targetCanvas.height);
  const data = imgData.data;
  const lutData = lut.data;
  const size = lut.size;

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];

    let rIdx = Math.floor((r / 255) * (size - 1));
    let gIdx = Math.floor((g / 255) * (size - 1));
    let bIdx = Math.floor((b / 255) * (size - 1));

    let lutIndex = (bIdx * size * size + gIdx * size + rIdx) * 4;

    data[i]     = lutData[lutIndex];
    data[i + 1] = lutData[lutIndex + 1];
    data[i + 2] = lutData[lutIndex + 2];
  }

  ctx.putImageData(imgData, 0, 0);
}

function compileFinalImage() {
  const context = canvas.getContext('2d');
  const config = FRAME_CONFIGS[selectedFrameKey];
  
  canvas.width = config.renderWidth;
  canvas.height = config.renderHeight;

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';

  capturedPoses.forEach((poseCanvas, index) => {
    const slot = config.slots[index];
    
    const videoRatio = poseCanvas.width / poseCanvas.height;
    const slotRatio = slot.w / slot.h;
    
    let sx = 0, sy = 0, sw = poseCanvas.width, sh = poseCanvas.height;

    if (videoRatio > slotRatio) {
      sw = poseCanvas.height * slotRatio;
      sx = (poseCanvas.width - sw) / 2;
    } else {
      sh = poseCanvas.width / slotRatio;
      sy = (poseCanvas.height - sh) / 2;
    }

    context.drawImage(poseCanvas, sx, sy, sw, sh, slot.x, slot.y, slot.w, slot.h);
  });

  if (activeFilter === 'fuji_astia') {
    applyHaldLUT(canvas, 'fuji_astia');
  }

  if (activeFrameImg.complete && activeFrameImg.naturalWidth !== 0) {
    context.drawImage(activeFrameImg, 0, 0, config.renderWidth, config.renderHeight);
  }

  const imageData = canvas.toDataURL('image/jpeg', 0.92);
  photoResult.src = imageData;
  downloadLink.href = imageData;

  boothScreen.style.display = "none";
  resultScreen.style.display = "flex";

  uploadToGoogleDrive(imageData);
}

function uploadToGoogleDrive(base64Image) {
  if (!GOOGLE_SCRIPT_URL) return;

  uploadStatus.innerText = "Menyimpan ke album acara...";

  fetch(GOOGLE_SCRIPT_URL, {
    method: "POST",
    body: JSON.stringify({ image: base64Image }),
    headers: { "Content-Type": "text/plain;charset=utf-8" }
  })
  .then(res => res.json())
  .then(data => {
    if(data.result === "success") {
      uploadStatus.innerText = "✨ Foto tersimpan di album acara!";
    } else {
      uploadStatus.innerText = "";
    }
  })
  .catch(err => {
    console.error(err);
    uploadStatus.innerText = "";
  });
}

function resetPhoto() {
  uploadStatus.innerText = "";
  resultScreen.style.display = "none";
  boothScreen.style.display = "flex";
  startCamera();
    }
  
