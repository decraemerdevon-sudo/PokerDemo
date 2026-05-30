export type SeatPoint = {
  x: number;
  y: number;
};

const SEAT_CENTER_MIN = 7;
const SEAT_CENTER_MAX = 93;

function clampSeatCenter(value: number) {
  return Math.min(SEAT_CENTER_MAX, Math.max(SEAT_CENTER_MIN, value));
}

export function getSeatAngles(totalSeats: number): number[] {
  const humanAngle = 180;
  const angleStep = 360 / Math.max(totalSeats, 1);
  return Array.from({ length: totalSeats }, (_, index) => (humanAngle - index * angleStep + 360) % 360);
}

export function getSeatPosition(seatAngle: number, tableCenter: SeatPoint, radius: number): SeatPoint {
  const angleRad = seatAngle * (Math.PI / 180);
  return {
    x: clampSeatCenter(tableCenter.x - radius * Math.sin(angleRad)),
    y: clampSeatCenter(tableCenter.y - radius * Math.cos(angleRad)),
  };
}

export function seatAngleForIndex(seatIndex: number, totalSeats: number) {
  return getSeatAngles(totalSeats)[seatIndex] ?? 0;
}
