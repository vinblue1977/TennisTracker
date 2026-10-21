"""One-off: make thumbnails for photos added before the app made them.

uv run --with pillow --with boto3 scripts/backfill_thumbs.py --table <table> --bucket <photo bucket>
"""

import argparse
import io

import boto3
from PIL import Image, ImageOps

CACHE_CONTROL = "private, max-age=31536000, immutable"
SIDE = 960

parser = argparse.ArgumentParser()
parser.add_argument("--table", required=True)
parser.add_argument("--bucket", required=True)
args = parser.parse_args()
table = boto3.resource("dynamodb").Table(args.table)
s3 = boto3.client("s3")

done = 0
for page in (
    boto3.client("dynamodb")
    .get_paginator("scan")
    .paginate(
        TableName=args.table,
        FilterExpression="begins_with(SK, :p) AND attribute_not_exists(thumb)",
        ExpressionAttributeValues={":p": {"S": "PHOTO#"}},
    )
):
    for raw in page["Items"]:
        pk, sk = raw["PK"]["S"], raw["SK"]["S"]
        user, photo_id = pk.removeprefix("USER#"), sk.rsplit("#", 1)[1]
        try:
            original = s3.get_object(Bucket=args.bucket, Key=f"{user}/{photo_id}.jpg")["Body"].read()
            image = ImageOps.exif_transpose(Image.open(io.BytesIO(original))).convert("RGB")
            image.thumbnail((SIDE, SIDE))
            out = io.BytesIO()
            image.save(out, "JPEG", quality=80)
            s3.put_object(
                Bucket=args.bucket,
                Key=f"{user}/{photo_id}_t.jpg",
                Body=out.getvalue(),
                ContentType="image/jpeg",
                CacheControl=CACHE_CONTROL,
            )
            table.update_item(Key={"PK": pk, "SK": sk}, UpdateExpression="SET thumb = :t", ExpressionAttributeValues={":t": True})
            print(f"{photo_id}: {len(original) // 1024} KB -> {out.tell() // 1024} KB")
            done += 1
        except Exception as err:  # noqa: BLE001 - report and carry on with the rest
            print(f"{photo_id}: skipped ({err})")
print(f"{done} done")
