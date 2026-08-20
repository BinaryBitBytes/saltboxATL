"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import {
  CreateLocationInputSchema,
  CreateRoomInputSchema,
  type CreateLocationInput,
  type CreateRoomInput,
  type Room,
} from "@/lib/inventory-schema";
import { createLocation, createRoom } from "@/backend/server/serverAction";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, NativeSelect } from "@/frontend/client/field";

export function LocationForms({ rooms }: { rooms: Room[] }) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <RoomForm />
      <LocationForm rooms={rooms} />
    </div>
  );
}

function RoomForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<CreateRoomInput>({
    resolver: zodResolver(CreateRoomInputSchema),
    defaultValues: { name: "", description: "" },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add room</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3"
          onSubmit={form.handleSubmit((values) => {
            setError(null);
            startTransition(async () => {
              const result = await createRoom(values);
              if (!result.ok) {
                setError(result.error);
                return;
              }
              form.reset({ name: "", description: "" });
              router.refresh();
            });
          })}
        >
          <Field label="Name" htmlFor="room-name" error={form.formState.errors.name?.message}>
            <Input id="room-name" {...form.register("name")} />
          </Field>
          <Field label="Description" htmlFor="room-description">
            <Input id="room-description" {...form.register("description")} />
          </Field>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Add room"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function LocationForm({ rooms }: { rooms: Room[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<CreateLocationInput>({
    resolver: zodResolver(CreateLocationInputSchema),
    defaultValues: { code: "", roomId: rooms[0]?.id ?? "", description: "" },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add location</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3"
          onSubmit={form.handleSubmit((values) => {
            setError(null);
            startTransition(async () => {
              const result = await createLocation(values);
              if (!result.ok) {
                setError(result.error);
                return;
              }
              form.reset({
                code: "",
                roomId: values.roomId,
                description: "",
              });
              router.refresh();
            });
          })}
        >
          <Field label="Room" error={form.formState.errors.roomId?.message}>
            <NativeSelect {...form.register("roomId")}>
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Location code" htmlFor="code" error={form.formState.errors.code?.message}>
            <Input id="code" placeholder="A-01-01" {...form.register("code")} />
          </Field>
          <Field label="Description" htmlFor="location-description">
            <Input id="location-description" {...form.register("description")} />
          </Field>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <Button type="submit" disabled={pending || rooms.length === 0}>
            {pending ? "Saving…" : "Add location"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
