#!/usr/bin/env python3
"""
Patch the Expo-generated android/app/build.gradle to:
  1. Replace versionCode with the CI run number
  2. Insert a signingConfigs.release block (if not already present)
  3. Replace any buildTypes.release signingConfig with signingConfigs.release

Environment variables (all required):
  KEYSTORE_ABS   - absolute path to the signing keystore file
  KEYSTORE_PASSWORD - signing keystore password
  KEY_ALIAS      - signing key alias
  KEY_PASSWORD   - signing key password
  GRADLE_FILE    - path to android/app/build.gradle
  RUN_NUMBER     - GitHub Actions run number to use as versionCode
"""

import re
import os
import sys

keystore_path = os.environ["KEYSTORE_ABS"]
os.environ["KEYSTORE_PASSWORD"]
os.environ["KEY_ALIAS"]
os.environ["KEY_PASSWORD"]
run_number = int(os.environ["RUN_NUMBER"])
gradle_file = os.environ["GRADLE_FILE"]

with open(gradle_file, "r") as f:
    lines = f.readlines()


def find_closing_brace(lines, start_idx):
    """Return the index of the line that closes the block opened at start_idx."""
    depth = 0
    for i in range(start_idx, len(lines)):
        depth += lines[i].count("{") - lines[i].count("}")
        if depth <= 0:
            return i
    return len(lines) - 1


# 1. Replace versionCode
for i, line in enumerate(lines):
    if "versionCode" in line and "//" not in line:
        lines[i] = re.sub(r"versionCode \d+", f"versionCode {run_number}", line)
        print(f"  versionCode updated on line {i + 1}")
        break

# 2. Ensure signingConfigs.release exists
signing_configs_start = None
for i, line in enumerate(lines):
    if re.search(r"\bsigningConfigs\s*\{", line):
        signing_configs_start = i
        break

if signing_configs_start is not None:
    signing_configs_end = find_closing_brace(lines, signing_configs_start)
    block_text = "".join(lines[signing_configs_start : signing_configs_end + 1])
    if "release" not in block_text:
        release_lines = [
            "        release {\n",
            f'            storeFile file("{keystore_path}")\n',
            '            storePassword System.getenv("KEYSTORE_PASSWORD")\n',
            '            keyAlias System.getenv("KEY_ALIAS")\n',
            '            keyPassword System.getenv("KEY_PASSWORD")\n',
            "        }\n",
        ]
        lines[signing_configs_end:signing_configs_end] = release_lines
        print("  Inserted signingConfigs.release block")
    else:
        print("  signingConfigs.release already present — skipping insert")
else:
    build_types_idx = next(
        (i for i, l in enumerate(lines) if re.search(r"\bbuildTypes\s*\{", l)), None
    )
    insert_at = build_types_idx if build_types_idx is not None else len(lines)
    signing_block = [
        "    signingConfigs {\n",
        "        release {\n",
        f'            storeFile file("{keystore_path}")\n',
        '            storePassword System.getenv("KEYSTORE_PASSWORD")\n',
        '            keyAlias System.getenv("KEY_ALIAS")\n',
        '            keyPassword System.getenv("KEY_PASSWORD")\n',
        "        }\n",
        "    }\n",
    ]
    lines[insert_at:insert_at] = signing_block
    print("  Created signingConfigs block with release entry")

# 3. Wire signingConfig into buildTypes.release (not into signingConfigs.release)
build_types_start = next(
    (i for i, l in enumerate(lines) if re.search(r"\bbuildTypes\s*\{", l)), None
)
if build_types_start is not None:
    build_types_end = find_closing_brace(lines, build_types_start)
    release_start = None
    for i in range(build_types_start + 1, build_types_end + 1):
        if re.search(r"\brelease\s*\{", lines[i]):
            release_start = i
            break
    if release_start is not None:
        release_end = find_closing_brace(lines, release_start)
        removed_signing_config_count = 0
        removed_signing_config = False
        for i in range(release_end - 1, release_start, -1):
            if re.search(r"\bsigningConfig\s+signingConfigs\.", lines[i]):
                del lines[i]
                removed_signing_config_count += 1
                removed_signing_config = True

        if removed_signing_config:
            print("  Removed existing buildTypes.release signingConfig")

        release_end -= removed_signing_config_count
        block_text = "".join(lines[release_start : release_end + 1])
        if "signingConfig signingConfigs.release" not in block_text:
            indent = "            "
            lines.insert(
                release_start + 1,
                f"{indent}signingConfig signingConfigs.release\n",
            )
            print("  Injected signingConfig into buildTypes.release")
        else:
            print("  signingConfig already present in buildTypes.release — skipping")
    else:
        print("WARNING: buildTypes.release block not found", file=sys.stderr)
else:
    print("WARNING: buildTypes block not found", file=sys.stderr)

with open(gradle_file, "w") as f:
    f.writelines(lines)

print("build.gradle patched successfully")
