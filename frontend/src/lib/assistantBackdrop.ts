/** Remove only neutral backdrop pixels connected to the edge of a video crop. */
export function clearAssistantBackdrop(pixels: Pick<ImageData, 'data' | 'width' | 'height'>) {
  const { data, width, height } = pixels;
  const visited = new Uint8Array(width * height);
  const stack: number[] = [];
  // A white shoe is indistinguishable from the floor by brightness alone.
  // Recover its silhouette from the pink outline/laces, separately for each foot.
  const pinkSeen = new Uint8Array(width * height);
  const shoes: Array<Array<[number, number]>> = [];
  const isPink = (i: number) => data[i * 4] > data[i * 4 + 1] + 16 && data[i * 4 + 2] > data[i * 4 + 1] + 8;
  for (let y = Math.floor(height * .66); y < height; y++) {
    for (let x = 0; x < width; x++) {
      const first = y * width + x;
      if (pinkSeen[first] || !isPink(first)) continue;
      const points: Array<[number, number]> = [];
      const todo = [first];
      pinkSeen[first] = 1;
      while (todo.length) {
        const i = todo.pop()!, px = i % width, py = Math.floor(i / width);
        points.push([px, py]);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx, ny = py + dy, next = ny * width + nx;
          if (nx < 0 || nx >= width || ny < height * .66 || ny >= height || pinkSeen[next] || !isPink(next)) continue;
          pinkSeen[next] = 1;
          todo.push(next);
        }
      }
      if (points.length >= 4) shoes.push(points);
    }
  }
  const bounds = (p: Array<[number, number]>) => ({ l: Math.min(...p.map(v => v[0])), r: Math.max(...p.map(v => v[0])), t: Math.min(...p.map(v => v[1])), b: Math.max(...p.map(v => v[1])) });
  // Join a lace to its own sole; never bridge the gap between the two shoes.
  for (let i = 0; i < shoes.length; i++) for (let j = i + 1; j < shoes.length; j++) {
    const a = bounds(shoes[i]), b = bounds(shoes[j]);
    if (Math.min(a.r, b.r) - Math.max(a.l, b.l) >= 3 && Math.max(a.t, b.t) - Math.min(a.b, b.b) <= 10) {
      shoes[i].push(...shoes[j]); shoes.splice(j, 1); i = -1; break;
    }
  }
  const protectedShoe = new Uint8Array(width * height);
  const cross = (a: number[], b: number[], c: number[]) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (const shoe of shoes) {
    if (shoe.length < 12) continue;
    // One pixel of padding covers antialiased white edges without retaining floor.
    const points = shoe.flatMap(([x, y]): Array<[number, number]> => [[x - 1, y - 2], [x + 1, y - 2], [x - 1, y + 1], [x + 1, y + 1]])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const lower: Array<[number, number]> = [], upper: Array<[number, number]> = [];
    for (const p of points) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
    for (const p of [...points].reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
    const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
    const b = bounds(hull);
    for (let y = Math.max(0, b.t); y <= Math.min(height - 1, b.b); y++) for (let x = Math.max(0, b.l); x <= Math.min(width - 1, b.r); x++) {
      if (hull.every((p, i) => cross(p, hull[(i + 1) % hull.length], [x, y]) >= 0)) protectedShoe[y * width + x] = 1;
    }
  }
  const isBackdrop = (index: number) => {
    const offset = index * 4;
    const r = data[offset], g = data[offset + 1], b = data[offset + 2];
    // Pink shoes have red AND blue highlights. Treating them as warm skin
    // (red greater than blue) let the flood fill erase the shoe uppers.
    const skin = r > g + 16 && r > b + 22;
    const pink = r > g + 16 && b > g + 8;
    return !protectedShoe[index] && Math.min(r, g, b) >= 135 && Math.max(r, g, b) - Math.min(r, g, b) < 45
      && !skin && !pink;
  };
  for (let x = 0; x < width; x += 1) stack.push(x, (height - 1) * width + x);
  for (let y = 0; y < height; y += 1) stack.push(y * width, y * width + width - 1);
  while (stack.length) {
    const index = stack.pop()!;
    if (visited[index] || !isBackdrop(index)) continue;
    visited[index] = 1;
    data[index * 4 + 3] = 0;
    const x = index % width;
    if (x > 0) stack.push(index - 1);
    if (x < width - 1) stack.push(index + 1);
    if (index >= width) stack.push(index - width);
    if (index < width * (height - 1)) stack.push(index + width);
  }
  // Seated legs can enclose patches of floor that are not edge-connected.
  for (let i = Math.floor(width * height * .66); i < width * height; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    // The beige floor between outstretched legs can have a warm red bias too.
    // Its low chroma separates it from skin; white shoes use the contour mask.
    if (!protectedShoe[i] && !isPink(i) && Math.min(r, g, b) >= 135 && Math.max(r, g, b) - Math.min(r, g, b) < 45) data[i * 4 + 3] = 0;
  }
}
