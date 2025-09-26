const CACHE_NAME = 'attendance-app-v1.1';
const OFFLINE_CACHE = 'attendance-offline-v1';

const urlsToCache = [
  '/',
  '/static/style.css',
  '/static/script.js',
  '/static/manifest.json',
  '/static/icon-192.png',
  '/static/icon-512.png',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://unpkg.com/html5-qrcode'
];

// Install Service Worker
self.addEventListener('install', event => {
  console.log('Service Worker installing...');
  event.waitUntil(
    Promise.all([
      caches.open(CACHE_NAME)
        .then(cache => cache.addAll(urlsToCache)),
      caches.open(OFFLINE_CACHE)
        .then(cache => cache.put('/offline-data', new Response('[]')))
    ]).then(() => self.skipWaiting())
  );
});

// Activate Service Worker
self.addEventListener('activate', event => {
  console.log('Service Worker activating...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME && cacheName !== OFFLINE_CACHE) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Enhanced Fetch Strategy with Offline Support
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Handle attendance submission offline
  if (request.method === 'POST' && url.pathname === '/recognize') {
    event.respondWith(handleOfflineRecognition(request));
    return;
  }

  // Handle QR scan offline
  if (request.method === 'POST' && url.pathname === '/qr_scan') {
    event.respondWith(handleOfflineQRScan(request));
    return;
  }

  // Handle student enrollment offline
  if (request.method === 'POST' && url.pathname === '/enroll') {
    event.respondWith(handleOfflineEnrollment(request));
    return;
  }

  // Handle analytics data offline
  if (url.pathname === '/analytics') {
    event.respondWith(handleOfflineAnalytics(request));
    return;
  }

  // Handle attendance records offline
  if (url.pathname === '/records') {
    event.respondWith(handleOfflineRecords(request));
    return;
  }

  // Handle login/register - require online
  if (url.pathname.startsWith('/login') || url.pathname.startsWith('/register')) {
    event.respondWith(
      fetch(request).catch(() => 
        new Response(JSON.stringify({
          status: 'error',
          message: 'Authentication requires internet connection'
        }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // Default caching strategy for static resources
  event.respondWith(
    caches.match(request)
      .then(response => response || fetch(request))
      .catch(() => {
        if (request.mode === 'navigate') {
          return caches.match('/');
        }
        return new Response('Offline', { status: 503 });
      })
  );
});

// Handle offline face recognition
async function handleOfflineRecognition(request) {
  try {
    // Try online first
    const response = await fetch(request);
    if (response.ok) {
      const data = await response.json();
      // Store successful recognition for sync later
      await storeOfflineAttendance(data);
      return response;
    }
  } catch (error) {
    console.log('Going offline for face recognition');
  }

  // Handle offline recognition
  const requestData = await request.json();
  const recognizedFaces = await performOfflineRecognition(requestData.imageDataURL);
  
  // Store offline attendance records
  for (const face of recognizedFaces) {
    if (face.name !== "Unknown") {
      await storeOfflineAttendance([face]);
    }
  }

  return new Response(JSON.stringify(recognizedFaces), {
    headers: { 'Content-Type': 'application/json' }
  });
}

// Handle offline QR scanning
async function handleOfflineQRScan(request) {
  try {
    const response = await fetch(request);
    if (response.ok) return response;
  } catch (error) {
    console.log('Going offline for QR scan');
  }

  const requestData = await request.json();
  const studentId = requestData.studentId;

  // Check if student exists in offline storage
  const knownStudents = await getOfflineStudents();
  if (!knownStudents.includes(studentId)) {
    return new Response(JSON.stringify({
      status: 'error',
      message: `Student ${studentId} not found in offline records`
    }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Store offline attendance
  await storeOfflineAttendance([{ name: studentId }], 'QR Scan');

  return new Response(JSON.stringify({
    status: 'success',
    message: `Offline attendance marked for ${studentId}`
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

// Handle offline student enrollment
async function handleOfflineEnrollment(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      // Also store offline for redundancy
      const data = await request.json();
      await storeOfflineStudent(data.studentId, data.imageDataURL);
      return response;
    }
  } catch (error) {
    console.log('Going offline for enrollment');
  }

  const requestData = await request.json();
  await storeOfflineStudent(requestData.studentId, requestData.imageDataURL);

  return new Response(JSON.stringify({
    status: 'success',
    message: `Student ${requestData.studentId} enrolled offline. Will sync when online.`,
    qrCode: generateOfflineQR(requestData.studentId)
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

// Handle offline analytics
async function handleOfflineAnalytics(request) {
  try {
    const response = await fetch(request);
    if (response.ok) return response;
  } catch (error) {
    console.log('Serving offline analytics');
  }

  const offlineRecords = await getOfflineAttendanceRecords();
  const analytics = generateOfflineAnalytics(offlineRecords);

  return new Response(JSON.stringify(analytics), {
    headers: { 'Content-Type': 'application/json' }
  });
}

// Handle offline records
async function handleOfflineRecords(request) {
  try {
    const response = await fetch(request);
    if (response.ok) return response;
  } catch (error) {
    console.log('Serving offline records');
  }

  const records = await getOfflineAttendanceRecords();
  return new Response(JSON.stringify(records), {
    headers: { 'Content-Type': 'application/json' }
  });
}

// Offline storage functions
async function storeOfflineAttendance(faces, source = 'Face Recognition') {
  const cache = await caches.open(OFFLINE_CACHE);
  const existing = await cache.match('/attendance-records');
  let records = [];
  
  if (existing) {
    records = await existing.json();
  }

  const timestamp = new Date();
  const dateStr = timestamp.toISOString().split('T')[0];
  const timeStr = timestamp.toTimeString().split(' ')[0];

  faces.forEach(face => {
    // Check if already marked today
    const alreadyMarked = records.some(record => 
      record.ID === face.name && record.Date === dateStr
    );

    if (!alreadyMarked) {
      records.push({
        ID: face.name,
        Name: face.name,
        Date: dateStr,
        Status: 'Present',
        Timestamp: timeStr,
        Source: source,
        Offline: true
      });
    }
  });

  await cache.put('/attendance-records', new Response(JSON.stringify(records)));
}

async function storeOfflineStudent(studentId, imageData) {
  const cache = await caches.open(OFFLINE_CACHE);
  const existing = await cache.match('/enrolled-students');
  let students = [];
  
  if (existing) {
    students = await existing.json();
  }

  students.push({
    id: studentId,
    imageData: imageData,
    enrolledAt: new Date().toISOString(),
    synced: false
  });

  await cache.put('/enrolled-students', new Response(JSON.stringify(students)));
}

async function getOfflineAttendanceRecords() {
  const cache = await caches.open(OFFLINE_CACHE);
  const response = await cache.match('/attendance-records');
  return response ? await response.json() : [];
}

async function getOfflineStudents() {
  const cache = await caches.open(OFFLINE_CACHE);
  const response = await cache.match('/enrolled-students');
  const students = response ? await response.json() : [];
  return students.map(s => s.id);
}

// Simplified offline face recognition (basic implementation)
async function performOfflineRecognition(imageDataURL) {
  // This is a simplified version - real implementation would need
  // face recognition libraries or pre-computed face encodings
  const knownStudents = await getOfflineStudents();
  
  // For demo purposes, randomly recognize a known student
  // In real implementation, you'd use face recognition algorithms
  if (knownStudents.length > 0) {
    const randomStudent = knownStudents[Math.floor(Math.random() * knownStudents.length)];
    return [{
      name: randomStudent,
      location: [100, 300, 200, 200] // dummy coordinates
    }];
  }
  
  return [{
    name: "Unknown",
    location: [100, 300, 200, 200]
  }];
}

function generateOfflineQR(studentId) {
  // Return a simple base64 QR code placeholder
  return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
}

function generateOfflineAnalytics(records) {
  const uniqueStudents = [...new Set(records.map(r => r.ID))];
  const uniqueDates = [...new Set(records.map(r => r.Date))];
  
  return {
    allStudents: uniqueStudents,
    summary: {
      totalStudents: uniqueStudents.length,
      totalDays: uniqueDates.length,
      totalRecords: records.length,
      busiestDay: uniqueDates[0] || 'N/A'
    },
    byDate: uniqueDates.map(date => ({
      Date: date,
      count: records.filter(r => r.Date === date).length
    })),
    byStudent: uniqueStudents.map(student => ({
      Name: student,
      DaysAttended: records.filter(r => r.ID === student).length,
      Percentage: uniqueDates.length > 0 ? 
        Math.round((records.filter(r => r.ID === student).length / uniqueDates.length) * 100) : 0
    })),
    bySource: [
      { Source: 'Face Recognition', count: records.filter(r => r.Source === 'Face Recognition').length },
      { Source: 'QR Scan', count: records.filter(r => r.Source === 'QR Scan').length }
    ].filter(item => item.count > 0),
    details: records
  };
}

// Background sync when back online
self.addEventListener('sync', event => {
  if (event.tag === 'sync-attendance') {
    event.waitUntil(syncOfflineData());
  }
});

async function syncOfflineData() {
  try {
    const cache = await caches.open(OFFLINE_CACHE);
    
    // Sync attendance records
    const attendanceResponse = await cache.match('/attendance-records');
    if (attendanceResponse) {
      const records = await attendanceResponse.json();
      const offlineRecords = records.filter(r => r.Offline);
      
      if (offlineRecords.length > 0) {
        // Send to server
        await fetch('/sync-attendance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(offlineRecords)
        });
        
        // Remove offline flag
        const updatedRecords = records.map(r => ({ ...r, Offline: false }));
        await cache.put('/attendance-records', new Response(JSON.stringify(updatedRecords)));
      }
    }
    
    // Sync enrolled students
    const studentsResponse = await cache.match('/enrolled-students');
    if (studentsResponse) {
      const students = await studentsResponse.json();
      const unsyncedStudents = students.filter(s => !s.synced);
      
      for (const student of unsyncedStudents) {
        await fetch('/enroll', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            studentId: student.id,
            imageDataURL: student.imageData
          })
        });
      }
      
      // Mark as synced
      const updatedStudents = students.map(s => ({ ...s, synced: true }));
      await cache.put('/enrolled-students', new Response(JSON.stringify(updatedStudents)));
    }
    
  } catch (error) {
    console.error('Sync failed:', error);
  }
}