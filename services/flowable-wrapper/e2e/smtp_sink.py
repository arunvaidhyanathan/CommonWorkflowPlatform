"""Local development mailbox: an SMTP server that accepts every message and
appends it to a file (and stdout). flowable-wrapper's mail tasks send here
by default (localhost:2525). Not for production.

    python3 -I services/flowable-wrapper/e2e/smtp_sink.py [port] [mailbox-file]
"""
import asyncio
import pathlib
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 2525
MAILBOX = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else ".local-logs/mailbox.txt")


async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    def send(line: str) -> None:
        writer.write((line + "\r\n").encode())

    send("220 cwp-dev-mailbox")
    envelope: list[str] = []
    while line := (await reader.readline()).decode(errors="replace").rstrip("\r\n"):
        command = line.upper()
        if command.startswith("DATA"):
            send("354 end with .")
            await writer.drain()
            body = []
            while (data := (await reader.readline()).decode(errors="replace").rstrip("\r\n")) != ".":
                body.append(data[1:] if data.startswith("..") else data)
            message = "\n".join(envelope + body) + "\n" + "=" * 60 + "\n"
            MAILBOX.parent.mkdir(parents=True, exist_ok=True)
            with MAILBOX.open("a") as f:
                f.write(message)
            print(message, flush=True)
            envelope = []
            send("250 stored")
        elif command.startswith("QUIT"):
            send("221 bye")
            break
        else:
            if command.startswith(("MAIL", "RCPT")):
                envelope.append(line)
            send("250 ok")
        await writer.drain()
    writer.close()


async def main() -> None:
    server = await asyncio.start_server(handle, "127.0.0.1", PORT)
    print(f"dev mailbox on 127.0.0.1:{PORT}, writing to {MAILBOX}", flush=True)
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    asyncio.run(main())
