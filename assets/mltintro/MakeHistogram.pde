/* @pjs preload="mandrill.jpg"; */

// A Practical Introduction to Metropolis Light Transport
// 2.1 Creating a Sampling Distribution
void makeHistogram(int w, int h, float[] F, float[] histogram, int mutations) {
  // Create an initial sample point
  int x0 = randomInteger(0, w - 1);
  int x1 = randomInteger(0, h - 1);
  float Fx = F[x1 * w + x0];

  // In this example, the tentative trasition function T simply chooses
  // a random pixel location, so Txy and Tyx are always equal.
  float Txy = 1.0 / (w * h);
  float Tyx = 1.0 / (w * h);

  // Create a histogram of values using Metropolis sampling.
  for (int i = 0; i < mutations; ++i) {
    // choose a tentative next sample according to T.
    int y0 = randomInteger(0, w - 1);
    int y1 = randomInteger(0, h - 1);
    float Fy = F[y1 * w + y0];
    float Axy = min(1.0, (Fy * Txy) / (Fx * Tyx));  // equation 2.
    if (randomReal(0.0, 1.0) < Axy) {
      x0 = y0;
      x1 = y1;
      Fx = Fy;
    }
    histogram[x1 * w + x0] += 1;
  }
}

int randomInteger(int min, int max) {
  return floor(random(max - min + 1)) + min;
}

float randomReal(float min, float max) {
  return random(max - min) + min;
}

PImage img;
float[] F;
float fAve;
float[] histogram;
long count;
int speed = 1 << 12;

void setup() {
  img = loadImage("mandrill.jpg");
  size(512, 256);  //size(img.width * 2, img.height);
  init();
  onInitialized();
}

void init() {
  F = new float[img.width * img.height];
  float fTotal = 0;
  for (int i = 0; i < img.height; ++i) {
    for (int j = 0; j < img.width; ++j) {
      color c = img.pixels[i * img.width + j];
      float b = brightness(c);
      F[i * img.width + j] = b;
      fTotal += b;
    }
  }
  fAve = fTotal / (img.width * img.height);
  drawHistogram(img.width, 0, img.width, img.height, F, 1);

  histogram = new float[img.width * img.height];
  count = 0;
}

void draw() {
  int mutations = speed;
  makeHistogram(img.width, img.height, F, histogram, mutations);
  count += mutations;

  float hAve = count / (float)(img.width * img.height);
  float s = fAve / hAve;
  drawHistogram(0, 0, img.width, img.height, histogram, s);

  onUpdated(count);
}

void drawHistogram(int x0, int y0, int w, int h, float[] histogram, float s) {
  for (int i = 0; i < h; ++i) {
    for (int j = 0; j < w; ++j) {
      float v = histogram[i * w + j] * s;
      int b = min((int)v, 255);
      set(j + x0, i + y0, color(b));
    }
  }
}

// from JS
void restart() {
  init();
}

void makeSlow() {
  if (speed > 1)
    speed /= 2;
}

void makeFast() {
  speed *= 2;
}
