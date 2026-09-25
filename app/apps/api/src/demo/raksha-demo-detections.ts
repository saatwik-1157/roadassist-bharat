/**
 * The RAKSHA demo corridor's detections: real YOLO11 output (yolo-rdd2022in-best) on
 * RDD2022 India images, from ai/cv-detections-full.json. Generated - do not edit
 * by hand; regenerate from that file.
 *
 * The detections are real model output. Their POSITIONS are simulated: RDD2022
 * images carry no GPS, so each is placed along NH-48 by the same formula and
 * with the same op ids as scripts/raksha-simulator.mjs --from-json. A boot-time
 * seed and a manual upload of that file are therefore replays of each other,
 * and the ingest route counts the second as duplicates.
 */
export interface DemoDetection {
  opId: string; type: string; severity: number; confidence: number;
  lat: number; lng: number; ageSeconds: number; imageRef: string; modelVersion: string;
}

export const RAKSHA_DEMO_MODEL = "yolo-rdd2022in-best";

export const RAKSHA_DEMO_DETECTIONS: readonly DemoDetection[] = [
  {
    "opId": "cv-India000053jpg-0",
    "type": "road_damage",
    "severity": 5,
    "confidence": 0.894,
    "lat": 28.455705,
    "lng": 77.023432,
    "ageSeconds": 0,
    "imageRef": "India_000053.jpg",
    "modelVersion": "yolo-rdd2022in-best"
  },
  {
    "opId": "cv-India000053jpg-1",
    "type": "pothole",
    "severity": 2,
    "confidence": 0.413,
    "lat": 28.4467,
    "lng": 77.0161,
    "ageSeconds": 30,
    "imageRef": "India_000053.jpg",
    "modelVersion": "yolo-rdd2022in-best"
  },
  {
    "opId": "cv-India000114jpg-0",
    "type": "road_damage",
    "severity": 5,
    "confidence": 0.805,
    "lat": 28.43669,
    "lng": 77.00917,
    "ageSeconds": 60,
    "imageRef": "India_000114.jpg",
    "modelVersion": "yolo-rdd2022in-best"
  },
  {
    "opId": "cv-India000127jpg-0",
    "type": "road_damage",
    "severity": 5,
    "confidence": 0.593,
    "lat": 28.42732,
    "lng": 77.00224,
    "ageSeconds": 90,
    "imageRef": "India_000127.jpg",
    "modelVersion": "yolo-rdd2022in-best"
  },
  {
    "opId": "cv-India000131jpg-0",
    "type": "road_damage",
    "severity": 5,
    "confidence": 0.465,
    "lat": 28.41849,
    "lng": 76.99449,
    "ageSeconds": 120,
    "imageRef": "India_000131.jpg",
    "modelVersion": "yolo-rdd2022in-best"
  },
  {
    "opId": "cv-India000168jpg-0",
    "type": "pothole",
    "severity": 5,
    "confidence": 0.362,
    "lat": 28.4102,
    "lng": 76.98584,
    "ageSeconds": 150,
    "imageRef": "India_000168.jpg",
    "modelVersion": "yolo-rdd2022in-best"
  },
  {
    "opId": "cv-India000270jpg-0",
    "type": "road_damage",
    "severity": 5,
    "confidence": 0.699,
    "lat": 28.4025,
    "lng": 76.9766,
    "ageSeconds": 180,
    "imageRef": "India_000270.jpg",
    "modelVersion": "yolo-rdd2022in-best"
  },
  {
    "opId": "cv-India000285jpg-0",
    "type": "road_damage",
    "severity": 5,
    "confidence": 0.439,
    "lat": 28.39552,
    "lng": 76.96736,
    "ageSeconds": 210,
    "imageRef": "India_000285.jpg",
    "modelVersion": "yolo-rdd2022in-best"
  },
  {
    "opId": "cv-India000292jpg-0",
    "type": "road_damage",
    "severity": 4,
    "confidence": 0.612,
    "lat": 28.38859,
    "lng": 76.95812,
    "ageSeconds": 240,
    "imageRef": "India_000292.jpg",
    "modelVersion": "yolo-rdd2022in-best"
  },
  {
    "opId": "cv-India000299jpg-0",
    "type": "road_damage",
    "severity": 5,
    "confidence": 0.572,
    "lat": 28.38192,
    "lng": 76.94888,
    "ageSeconds": 270,
    "imageRef": "India_000299.jpg",
    "modelVersion": "yolo-rdd2022in-best"
  },
  {
    "opId": "cv-India000299jpg-1",
    "type": "road_damage",
    "severity": 5,
    "confidence": 0.389,
    "lat": 28.37579,
    "lng": 76.93964,
    "ageSeconds": 300,
    "imageRef": "India_000299.jpg",
    "modelVersion": "yolo-rdd2022in-best"
  },
  {
    "opId": "cv-India000316jpg-0",
    "type": "pothole",
    "severity": 2,
    "confidence": 0.42,
    "lat": 28.3704,
    "lng": 76.9304,
    "ageSeconds": 330,
    "imageRef": "India_000316.jpg",
    "modelVersion": "yolo-rdd2022in-best"
  },
  {
    "opId": "cv-India000317jpg-0",
    "type": "road_damage",
    "severity": 5,
    "confidence": 0.619,
    "lat": 28.36444,
    "lng": 76.92059,
    "ageSeconds": 360,
    "imageRef": "India_000317.jpg",
    "modelVersion": "yolo-rdd2022in-best"
  },
  {
    "opId": "cv-India000317jpg-1",
    "type": "road_damage",
    "severity": 5,
    "confidence": 0.383,
    "lat": 28.35862,
    "lng": 76.91058,
    "ageSeconds": 390,
    "imageRef": "India_000317.jpg",
    "modelVersion": "yolo-rdd2022in-best"
  },
  {
    "opId": "cv-India000368jpg-0",
    "type": "pothole",
    "severity": 2,
    "confidence": 0.613,
    "lat": 28.458235,
    "lng": 77.025544,
    "ageSeconds": 420,
    "imageRef": "India_000368.jpg",
    "modelVersion": "yolo-rdd2022in-best"
  },
  {
    "opId": "cv-India000368jpg-1",
    "type": "pothole",
    "severity": 2,
    "confidence": 0.5,
    "lat": 28.44938,
    "lng": 77.018152,
    "ageSeconds": 450,
    "imageRef": "India_000368.jpg",
    "modelVersion": "yolo-rdd2022in-best"
  },
  {
    "opId": "cv-India000368jpg-2",
    "type": "road_damage",
    "severity": 2,
    "confidence": 0.466,
    "lat": 28.43955,
    "lng": 77.01115,
    "ageSeconds": 480,
    "imageRef": "India_000368.jpg",
    "modelVersion": "yolo-rdd2022in-best"
  },
  {
    "opId": "cv-India000409jpg-0",
    "type": "road_damage",
    "severity": 5,
    "confidence": 0.648,
    "lat": 28.42996,
    "lng": 77.00422,
    "ageSeconds": 510,
    "imageRef": "India_000409.jpg",
    "modelVersion": "yolo-rdd2022in-best"
  },
  {
    "opId": "cv-India000432jpg-0",
    "type": "road_damage",
    "severity": 4,
    "confidence": 0.712,
    "lat": 28.42091,
    "lng": 76.99691,
    "ageSeconds": 540,
    "imageRef": "India_000432.jpg",
    "modelVersion": "yolo-rdd2022in-best"
  },
  {
    "opId": "cv-India000432jpg-1",
    "type": "road_damage",
    "severity": 4,
    "confidence": 0.38,
    "lat": 28.41244,
    "lng": 76.98844,
    "ageSeconds": 570,
    "imageRef": "India_000432.jpg",
    "modelVersion": "yolo-rdd2022in-best"
  },
  {
    "opId": "cv-India000456jpg-0",
    "type": "road_damage",
    "severity": 2,
    "confidence": 0.548,
    "lat": 28.4047,
    "lng": 76.97924,
    "ageSeconds": 600,
    "imageRef": "India_000456.jpg",
    "modelVersion": "yolo-rdd2022in-best"
  },
  {
    "opId": "cv-India000456jpg-1",
    "type": "pothole",
    "severity": 2,
    "confidence": 0.366,
    "lat": 28.3975,
    "lng": 76.97,
    "ageSeconds": 630,
    "imageRef": "India_000456.jpg",
    "modelVersion": "yolo-rdd2022in-best"
  },
  {
    "opId": "cv-India000462jpg-0",
    "type": "road_damage",
    "severity": 4,
    "confidence": 0.503,
    "lat": 28.39057,
    "lng": 76.96076,
    "ageSeconds": 660,
    "imageRef": "India_000462.jpg",
    "modelVersion": "yolo-rdd2022in-best"
  },
  {
    "opId": "cv-India000472jpg-0",
    "type": "road_damage",
    "severity": 5,
    "confidence": 0.608,
    "lat": 28.38368,
    "lng": 76.95152,
    "ageSeconds": 690,
    "imageRef": "India_000472.jpg",
    "modelVersion": "yolo-rdd2022in-best"
  },
  {
    "opId": "cv-India000493jpg-0",
    "type": "road_damage",
    "severity": 5,
    "confidence": 0.877,
    "lat": 28.37752,
    "lng": 76.94228,
    "ageSeconds": 720,
    "imageRef": "India_000493.jpg",
    "modelVersion": "yolo-rdd2022in-best"
  },
  {
    "opId": "cv-India000517jpg-0",
    "type": "road_damage",
    "severity": 5,
    "confidence": 0.523,
    "lat": 28.37194,
    "lng": 76.93304,
    "ageSeconds": 750,
    "imageRef": "India_000517.jpg",
    "modelVersion": "yolo-rdd2022in-best"
  },
  {
    "opId": "cv-India000524jpg-0",
    "type": "road_damage",
    "severity": 5,
    "confidence": 0.71,
    "lat": 28.3662,
    "lng": 76.92345,
    "ageSeconds": 780,
    "imageRef": "India_000524.jpg",
    "modelVersion": "yolo-rdd2022in-best"
  },
  {
    "opId": "cv-India000556jpg-0",
    "type": "road_damage",
    "severity": 5,
    "confidence": 0.466,
    "lat": 28.36016,
    "lng": 76.91344,
    "ageSeconds": 810,
    "imageRef": "India_000556.jpg",
    "modelVersion": "yolo-rdd2022in-best"
  },
  {
    "opId": "cv-India000556jpg-1",
    "type": "road_damage",
    "severity": 4,
    "confidence": 0.358,
    "lat": 28.35477,
    "lng": 76.90343,
    "ageSeconds": 840,
    "imageRef": "India_000556.jpg",
    "modelVersion": "yolo-rdd2022in-best"
  },
  {
    "opId": "cv-India000586jpg-0",
    "type": "road_damage",
    "severity": 4,
    "confidence": 0.436,
    "lat": 28.45191,
    "lng": 77.020264,
    "ageSeconds": 870,
    "imageRef": "India_000586.jpg",
    "modelVersion": "yolo-rdd2022in-best"
  },
  {
    "opId": "cv-India000614jpg-0",
    "type": "pothole",
    "severity": 3,
    "confidence": 0.515,
    "lat": 28.44241,
    "lng": 77.01313,
    "ageSeconds": 900,
    "imageRef": "India_000614.jpg",
    "modelVersion": "yolo-rdd2022in-best"
  },
  {
    "opId": "cv-India000656jpg-0",
    "type": "road_damage",
    "severity": 5,
    "confidence": 0.578,
    "lat": 28.4326,
    "lng": 77.0062,
    "ageSeconds": 930,
    "imageRef": "India_000656.jpg",
    "modelVersion": "yolo-rdd2022in-best"
  },
  {
    "opId": "cv-India000684jpg-0",
    "type": "pothole",
    "severity": 5,
    "confidence": 0.438,
    "lat": 28.42336,
    "lng": 76.99927,
    "ageSeconds": 960,
    "imageRef": "India_000684.jpg",
    "modelVersion": "yolo-rdd2022in-best"
  },
  {
    "opId": "cv-India000705jpg-0",
    "type": "pothole",
    "severity": 2,
    "confidence": 0.608,
    "lat": 28.41486,
    "lng": 76.99086,
    "ageSeconds": 990,
    "imageRef": "India_000705.jpg",
    "modelVersion": "yolo-rdd2022in-best"
  }
];
