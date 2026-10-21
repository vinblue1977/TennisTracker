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

scan = table.scan(
    FilterExpression="begins_with(SK, :p) AND attribute_not_exists(thumb)", ExpressionAttributeValues={":p": "PHOTO#"}
)
for item in scan["Items"]:
    user, photo_id = item["PK"].removeprefix("USER#"), item["SK"].rsplit("#", 1)[1]
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
    table.update_item(
        Key={"PK": item["PK"], "SK": item["SK"]}, UpdateExpression="SET thumb = :t", ExpressionAttributeValues={":t": True}
    )
    print(f"{photo_id}: {len(original) // 1024} KB -> {out.tell() // 1024} KB")
print(f"{len(scan['Items'])} done")
