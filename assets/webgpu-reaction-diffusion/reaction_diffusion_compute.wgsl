struct Uniform {
    grid: vec2f,
    dA: f32,
    dB: f32,
    feed: f32,
    kill: f32,
};

struct CellState {
    a: f32,
    b: f32,
    _c: f32,
    _d: f32,
};

@group(0) @binding(0) var<uniform> param: Uniform;
@group(0) @binding(1) var<storage, read> cellStateIn: array<CellState>;
@group(0) @binding(2) var<storage, read_write> cellStateOut: array<CellState>;

fn cellIndex(x: u32, y: u32) -> u32 {
    return (y % u32(param.grid.y)) * u32(param.grid.x) + (x % u32(param.grid.x));
}

fn laplaceA(x: u32, y: u32) -> f32 {
    let h = u32(param.grid.y);
    let w = u32(param.grid.x);
    let x0 = (x - 1 + w) % w;
    let y0 = (y - 1 + h) % h;
    let x1 = x;
    let y1 = y;
    let x2 = (x + 1) % w;
    let y2 = (y + 1) % h;
    return (cellStateIn[cellIndex(x0, y0)].a * 0.05 + cellStateIn[cellIndex(x1, y0)].a * 0.2 + cellStateIn[cellIndex(x2, y0)].a * 0.05 +
            cellStateIn[cellIndex(x0, y1)].a * 0.2  + cellStateIn[cellIndex(x1, y1)].a * -1  + cellStateIn[cellIndex(x2, y1)].a * 0.2 +
            cellStateIn[cellIndex(x0, y2)].a * 0.05 + cellStateIn[cellIndex(x1, y2)].a * 0.2 + cellStateIn[cellIndex(x2, y2)].a * 0.05);
}

fn laplaceB(x: u32, y: u32) -> f32 {
    let h = u32(param.grid.y);
    let w = u32(param.grid.x);
    let x0 = (x - 1 + w) % w;
    let y0 = (y - 1 + h) % h;
    let x1 = x;
    let y1 = y;
    let x2 = (x + 1) % w;
    let y2 = (y + 1) % h;
    return (cellStateIn[cellIndex(x0, y0)].b * 0.05 + cellStateIn[cellIndex(x1, y0)].b * 0.2 + cellStateIn[cellIndex(x2, y0)].b * 0.05 +
            cellStateIn[cellIndex(x0, y1)].b * 0.2  + cellStateIn[cellIndex(x1, y1)].b * -1  + cellStateIn[cellIndex(x2, y1)].b * 0.2 +
            cellStateIn[cellIndex(x0, y2)].b * 0.05 + cellStateIn[cellIndex(x1, y2)].b * 0.2 + cellStateIn[cellIndex(x2, y2)].b * 0.05);
}

const WORKGROUP_SIZE = 8;

@compute
@workgroup_size(WORKGROUP_SIZE, WORKGROUP_SIZE)
fn computeMain(@builtin(global_invocation_id) cell: vec3u) {
    let dA = param.dA;
    let dB = param.dB;
    let feed = param.feed;
    let kill = param.kill;

    let i = cellIndex(cell.x, cell.y);
    let a = cellStateIn[i].a;
    let b = cellStateIn[i].b;
    cellStateOut[i].a = a + (dA * laplaceA(cell.x, cell.y)) - (a * b * b) + feed * (1 - a);
    cellStateOut[i].b = b + (dB * laplaceB(cell.x, cell.y)) + (a * b * b) - (kill + feed) * b;
}
