type VisionSpriteProps = {
  size?: number;
  tint?: string;
};

export default function VisionSprite({ size = 32, tint }: VisionSpriteProps) {
  const px = size / 16;

  const P = tint || "#7c3aed"; // purple face
  const D = tint ? shadeColor(tint, -30) : "#4c1d95"; // darker shade
  const E = "#eab308"; // eye — gold
  const G = "#22c55e"; // gem — green Mind Stone
  const _ = "none";

  const grid: string[][] = [
    [_, _, _, P, P, P, P, P, P, P, P, P, _, _, _, _],
    [_, _, P, P, P, P, P, P, P, P, P, P, P, _, _, _],
    [_, P, P, P, P, P, P, P, P, P, P, P, P, P, _, _],
    [_, P, P, _, _, _, G, G, G, _, _, _, P, P, _, _],
    [_, P, P, _, _, G, G, G, G, G, _, _, P, P, _, _],
    [_, P, P, _, G, G, G, G, G, G, G, _, P, P, _, _],
    [_, P, P, _, _, G, G, G, G, G, _, _, P, P, _, _],
    [_, P, P, _, _, _, G, G, G, _, _, _, P, P, _, _],
    [_, D, P, P, _, _, _, _, _, _, _, P, P, D, _, _],
    [_, D, P, E, E, _, _, _, _, E, E, P, P, D, _, _],
    [_, D, P, E, E, _, _, _, _, E, E, P, P, D, _, _],
    [_, D, P, P, _, _, _, _, _, _, _, P, P, D, _, _],
    [_, D, P, _, D, D, _, _, D, D, _, _, P, D, _, _],
    [_, _, D, P, P, P, P, P, P, P, P, P, D, _, _, _],
    [_, _, _, D, D, P, P, P, P, D, D, _, _, _, _, _],
    [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
  ];

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ imageRendering: "pixelated" }}
    >
      {grid.flatMap((row, y) =>
        row.map((color, x) =>
          color !== _ ? (
            <rect
              key={`${x}-${y}`}
              x={x * px}
              y={y * px}
              width={px}
              height={px}
              fill={color}
            />
          ) : null
        )
      )}
    </svg>
  );
}

function shadeColor(hex: string, amount: number): string {
  const num = parseInt(hex.replace("#", ""), 16);
  const r = Math.max(0, Math.min(255, (num >> 16) + amount));
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0xff) + amount));
  const b = Math.max(0, Math.min(255, (num & 0xff) + amount));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}
