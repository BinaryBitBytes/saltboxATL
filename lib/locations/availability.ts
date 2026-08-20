import type { Location, Room } from "@/lib/inventory-schema";

export type EmptyLocation = Location & { roomName: string };

export function emptyActiveLocations(
  locations: Location[],
  rooms: Room[],
  items: Array<{ locationId: string; quantity: number }>,
): EmptyLocation[] {
  const occupied = new Set(
    items
      .filter((item) => item.quantity > 0)
      .map((item) => item.locationId),
  );
  const roomNames = new Map(rooms.map((room) => [room.id, room.name]));

  return locations
    .filter((location) => location.isActive && !occupied.has(location.id))
    .map((location) => ({
      ...location,
      roomName: roomNames.get(location.roomId) ?? "Unknown room",
    }))
    .sort((left, right) => left.code.localeCompare(right.code));
}
