// script.js

// 1. GLOBAL VARIABLES AND STATE
// =============================
const recordButton = document.getElementById('recordButton');
const canvas = document.getElementById('visualizerCanvas');
const ctx = canvas.getContext('2d');

const CANVAS_SIZE = 400;
canvas.width = CANVAS_SIZE;
canvas.height = CANVAS_SIZE;

const centerX = canvas.width / 2;
const centerY = canvas.height / 2;
const baseRadius = 100;

const RECORDING_TIME_LIMIT = 5;
const NUM_SAMPLES = 60; //more degrees -> more contour

let countdownInterval;
let timeLeft;

let audioContext;
let analyser;
let microphone;
let dataArray;
let bufferLength;

let isRecording = false;
let recordingStartTime;
let recordedAmplitudes = [];
let finalWaveformPoints = [];

const AMPLITUDE_SCALE = 100;      // controls final spike height (tweakable)
const AMP_SMOOTH_ALPHA = 0.25;   // exponential smoothing factor (0..1). Higher = smoother, slower
let smoothedAmplitude = 0.3;       // running smoothed amplitude value

// 2. SETUP AUDIO CONTEXT AND ANALYSER
// =============================
function setupAudio() {
    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }
    
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.8;
    bufferLength = analyser.frequencyBinCount;
    dataArray = new Uint8Array(bufferLength);

    navigator.mediaDevices.getUserMedia({ audio: true })
        .then(function(stream) {
            microphone = audioContext.createMediaStreamSource(stream);
            microphone.connect(analyser);
        })
        .catch(function(err) {
            console.error('Error accessing microphone:', err);
            stopRecording();
            alert('Could not access your microphone. Please check your permissions.');
        });
}

// 3. DRAWING THE CIRCULAR WAVEFORM
// =============================
function drawVisualizer() {
    requestAnimationFrame(drawVisualizer);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (finalWaveformPoints.length > 0) {
        drawPerfectFinalRing();
        return;
    }

    if (!isRecording || !analyser) {
        return;
    }

    const currentTime = Date.now();
    const elapsedTime = (currentTime - recordingStartTime) / 1000;
    
    if (elapsedTime >= RECORDING_TIME_LIMIT) {
        stopRecording();
        return;
    }

    analyser.getByteTimeDomainData(dataArray);
    
    let sum = 0;
    for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
    }
    const averageAmplitude = (sum / bufferLength / 128.0) - 1.0;
    
    const scaledAmplitude = Math.sin(averageAmplitude * Math.PI) * 1400;
    
    const currentAngleIndex = Math.floor((elapsedTime / RECORDING_TIME_LIMIT) * NUM_SAMPLES);
    const currentAngle = 2 * Math.PI * (currentAngleIndex / NUM_SAMPLES);
    
    if (recordedAmplitudes.length <= currentAngleIndex) {
        recordedAmplitudes.push({
            angle: currentAngle,
            amplitude: scaledAmplitude
        });
    } else {
        recordedAmplitudes[currentAngleIndex] = {
            angle: currentAngle,
            amplitude: scaledAmplitude
        };
    }

    drawPerfectProgressRing();
}

// 4. DRAWING FUNCTIONS
// =============================
function drawPerfectProgressRing() {
  const n = recordedAmplitudes.length;
  if (n === 0) return;

  // Convert recorded samples -> XY points
  const points = [];
  for (let i = 0; i < n; i++) {
    const p = recordedAmplitudes[i];
    const x = centerX + Math.cos(p.angle) * (baseRadius + p.amplitude);
    const y = centerY + Math.sin(p.angle) * (baseRadius + p.amplitude);
    points.push({ x, y });
  }

  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 3;
  ctx.shadowColor = "rgba(255,255,255,0.8)";
  ctx.shadowBlur = 12;

  // (1) Only 1 point: draw a dot
  if (points.length === 1) {
    ctx.beginPath();
    ctx.arc(points[0].x, points[0].y, 3, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.shadowBlur = 0;
    return;
  }

  // (2) Exactly 2 points: straight line
  if (points.length === 2) {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    ctx.lineTo(points[1].x, points[1].y);
    ctx.stroke();
    ctx.shadowBlur = 0;
    return;
  }

  // (3) 3+ points: Catmull-Rom smoothing replaces jagged lines
  ctx.beginPath();
  drawCatmullRomSpline(ctx, points, 2, false);
  ctx.stroke();
  ctx.shadowBlur = 0;
}


function drawPerfectFinalRing() {
    if (finalWaveformPoints.length < 2) return;

    ctx.beginPath();
    drawCatmullRomSpline(ctx, [...finalWaveformPoints], 0.5, true);
    
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 4;
    ctx.shadowColor = "rgba(255,255,255,0.9)";
    ctx.shadowBlur = 15;
    ctx.stroke();
    ctx.shadowBlur = 0;
}

// Helper function
function drawCatmullRomSpline(ctx, points, tension, closed) {
    if (points.length < 2) return;
    const pts = [...points];
    if (closed && pts.length > 2) {
        pts.push(pts[0]);
    }
    
    ctx.moveTo(pts[0].x, pts[0].y);
    
    for (let i = 0; i < pts.length - 1; i++) {
        const p0 = i > 0 ? pts[i - 1] : pts[0];
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const p3 = i < pts.length - 2 ? pts[i + 2] : p2;
        
        const cp1x = p1.x + (p2.x - p0.x) / 6 * tension;
        const cp1y = p1.y + (p2.y - p0.y) / 6 * tension;
        const cp2x = p2.x - (p3.x - p1.x) / 6 * tension;
        const cp2y = p2.y - (p3.y - p1.y) / 6 * tension;
        
        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
    }
}

// 5. COUNTDOWN (hidden, just timing)
// =============================
function startCountdown() {
    timeLeft = RECORDING_TIME_LIMIT;
    countdownInterval = setInterval(() => {
        timeLeft--;
        if (timeLeft <= 0) {
            stopRecording();
        }
    }, 1000);
}

// 6. STOP RECORDING
// =============================
function stopRecording() {
    isRecording = false;
    
    if (countdownInterval) clearInterval(countdownInterval);
    
    if (recordedAmplitudes.length > 0) {
        recordedAmplitudes.sort((a, b) => a.angle - b.angle);
        
        finalWaveformPoints = [];
        for (let i = 0; i < recordedAmplitudes.length; i++) {
            const point = recordedAmplitudes[i];
            const x = centerX + Math.cos(point.angle) * (baseRadius + point.amplitude);
            const y = centerY + Math.sin(point.angle) * (baseRadius + point.amplitude);
            finalWaveformPoints.push({x, y});
        }
        if (finalWaveformPoints.length > 0) {
            finalWaveformPoints.push({...finalWaveformPoints[0]});
        }
    }

    // Change button to "Continue"
    recordButton.textContent = 'Continue';
    recordButton.classList.remove('recording');
    recordButton.classList.add('continue');

    if (microphone) {
        microphone.mediaStream.getTracks().forEach(track => track.stop());
        microphone = null;
    }

    // inside stopRecording(), at the end
    localStorage.setItem("waveformPoints", JSON.stringify(finalWaveformPoints));

}

// 7. BUTTON CLICK HANDLER
// =============================
recordButton.addEventListener('click', function() {
    // If already in "Continue" state, go to mesh page
    if (recordButton.classList.contains('continue')) {
        window.location.href = 'mesh.html';
        return;
    }

    if (isRecording) {
        stopRecording();
    } else {
        finalWaveformPoints = [];
        recordedAmplitudes = [];
        isRecording = true;
        recordingStartTime = Date.now();
        recordButton.textContent = 'Recording...';
        recordButton.classList.remove('continue');
        recordButton.classList.add('recording');

        if (audioContext) {
            audioContext.close().then(() => {
                audioContext = null;
                setupAudio();
            });
        } else {
            setupAudio();
        }
        
        startCountdown();
    }
});

// 8. INITIALIZE
// =============================
drawVisualizer();

// 9. CLEANUP
// =============================
window.addEventListener('beforeunload', () => {
    if (countdownInterval) clearInterval(countdownInterval);
    if (microphone) {
        microphone.mediaStream.getTracks().forEach(track => track.stop());
    }
    if (audioContext) {
        audioContext.close();
    }
});
