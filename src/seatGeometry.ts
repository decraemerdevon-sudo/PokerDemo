export type SeatPoint = {
  x: number;
  y: number;
};

export function getSeatAngles(totalSeats: number): number[] {
  if (totalSeats === 3) return [180, 240, 60];
  const humanAngle = 180;
  const angleStep = 360 / totalSeats;
  return Array.from({ length: totalSeats }, (_, index) => (humanAngle + index * angleStep) % 360);
}

export function getSeatPosition(seatAngle: number, tableCenter: SeatPoint, radius: number): SeatPoint {
  const angleRad = seatAngle * (Math.PI / 180);
  return {
    x: tableCenter.x - radius * Math.sin(angleRad),
    y: tableCenter.y - radius * Math.cos(angleRad),
  };
}

export function seatAngleForIndex(seatIndex: number, totalSeats: number) {
  return getSeatAngles(totalSeats)[seatIndex] ?? 0;
}
