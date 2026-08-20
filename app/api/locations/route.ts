import {
  createLocationRecord,
  createRoomRecord,
  listSystem,
  ServiceError,
} from "@/backend/server/inventory-service";
import { requireApiPermission, requireApiUser } from "@/backend/server/dal";
import { jsonError, jsonOk } from "@/backend/server/http";

export async function GET() {
  try {
    await requireApiUser();
    const system = await listSystem();
    return jsonOk({
      rooms: system.rooms,
      locations: system.locations,
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireApiPermission("manageLocations");
    const body = (await request.json()) as {
      type?: "room" | "location";
      payload?: unknown;
    };

    if (body.type === "room") {
      return jsonOk(await createRoomRecord(body.payload), 201);
    }
    if (body.type === "location") {
      return jsonOk(await createLocationRecord(body.payload), 201);
    }

    return jsonError(new ServiceError("type must be room or location"));
  } catch (error) {
    return jsonError(error);
  }
}
