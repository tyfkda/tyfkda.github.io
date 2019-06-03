class DomainLocation {
  int xloc, yloc;

  void set(DomainLocation l) {
    xloc = l.xloc;
    yloc = l.yloc;
  }
}

// A Practical Introduction to Metropolis Light Transport
// 2.2 Color Images
void makeHistogram(int w, int h, PVector[] F, PVector[] histogram, int mutations) {
  // Create an initial sample point
  DomainLocation X = new DomainLocation();
  X.xloc = randomInteger(0, w - 1);
  X.yloc = randomInteger(0, h - 1);
  PVector colorX = new PVector(F[X.yloc * w + X.xloc].x, F[X.yloc * w + X.xloc].y, F[X.yloc * w + X.xloc].z);
  float Fx = luminance(colorX);
  if (Fx > 0)
    colorX.mult(1.0 / Fx);

  DomainLocation Y = new DomainLocation();

  // Create a histogram of values using Metropolis sampling.
  for (int i = 0; i < mutations; ++i) {
    // choose a tentative next sample according to T.
    mutateAccordingToT(w, h, X, Y);
    float Tyx = T(w, h, Y, X);
    float Txy = T(w, h, X, Y);

    PVector colorY = F[Y.yloc * w + Y.xloc];
    float Fy = luminance(colorY);
    float Axy = min(1.0, (Fy * Txy) / (Fx * Tyx));  // equation 2.
    if (randomReal(0.0, 1.0) < Axy) {
      X.set(Y);
      Fx = Fy;
      colorX.set(colorY);
      colorX.mult(1 / Fy);
    }
    histogram[X.yloc * w + X.xloc].add(colorX);
  }
}

void mutateAccordingToT(int w, int h, DomainLocation X, DomainLocation Y) {
  Y.xloc = randomInteger(0, w - 1);
  Y.yloc = randomInteger(0, h - 1);
}

float T(int w, int h, DomainLocation X, DomainLocation Y) {
  return 1.0 / (w * h);
}

float luminance(PVector v) {
  return 0.299 * v.x + 0.587 * v.y + 0.114 * v.z;
}

int randomInteger(int min, int max) {
  return floor(random(max - min + 1)) + min;
}

float randomReal(float min, float max) {
  return random(max - min) + min;
}

/* @pjs preload="mandrill.jpg"; */
PImage img;
PVector[] F;
float fAve;
PVector[] histogram;
long count;
int speed = 1 << 12;

void setup() {
  img = loadImage("mandrill.jpg");
  //size(img.width * 2, img.height);  // Javascriptでエクスポートした時にうまく動かない
  size(512, 256);
  init();
  onInitialized();
}

void init() {
  F = new PVector[img.width * img.height];
  float fTotal = 0;
  for (int i = 0; i < img.height; ++i) {
    for (int j = 0; j < img.width; ++j) {
      color c = img.pixels[i * img.width + j];
      PVector cc = new PVector(red(c) / 255, green(c) / 255, blue(c) / 255);
      F[i * img.width + j] = cc;
      fTotal += luminance(cc);
    }
  }
  fAve = fTotal / (img.width * img.height);
  drawHistogram(img.width, 0, img.width, img.height, F, 255);

  histogram = new PVector[img.width * img.height];
  for (int i = 0; i < img.width * img.height; ++i)
    histogram[i] = new PVector(0, 0, 0);

  count = 0;
}

void draw() {
  int mutations = speed;
  makeHistogram(img.width, img.height, F, histogram, mutations);
  count += mutations;

  float hAve = count / (float)(img.width * img.height) / 255.0f;
  float s = fAve / hAve;
  drawHistogram(0, 0, img.width, img.height, histogram, s);

  onUpdated(count);
}

void drawHistogram(int x0, int y0, int w, int h, PVector[] histogram, float s) {
  for (int i = 0; i < h; ++i) {
    for (int j = 0; j < w; ++j) {
      PVector c = histogram[i * w + j];
      int ir = (int)min(c.x * s, 255);
      int ig = (int)min(c.y * s, 255);
      int ib = (int)min(c.z * s, 255);
      set(j + x0, i + y0, color(ir, ig, ib));
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
