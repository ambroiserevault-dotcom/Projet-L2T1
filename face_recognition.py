# deepface_realtime.py
from deepface import DeepFace
import cv2
import time
import json
import sys
import base64
import numpy as np

emotions = {}
ages = []
start_time = time.time()
last_output_time = time.time()
frame_count = 0

sys.stderr.write("Face recognition script started, waiting for frames...\n")
sys.stderr.flush()

# Read frames from stdin (sent by Node.js server as base64)
while True:
    try:
        line = sys.stdin.readline()
        if not line:
            break
        
        frame_count += 1
        sys.stderr.write(f"Received frame #{frame_count}\n")
        sys.stderr.flush()
        
        data = json.loads(line)
        frame_base64 = data.get("frame")
        
        if not frame_base64:
            continue
        
        # Handle data URI format (data:image/jpeg;base64,...)
        if frame_base64.startswith("data:image"):
            frame_base64 = frame_base64.split(",", 1)[1]
        
        # Decode base64 to image
        try:
            frame_data = base64.b64decode(frame_base64)
            frame = cv2.imdecode(np.frombuffer(frame_data, np.uint8), cv2.IMREAD_COLOR)
            
            if frame is None:
                sys.stderr.write(f"Frame #{frame_count}: Failed to decode image\n")
                sys.stderr.flush()
                continue
        except Exception as e:
            sys.stderr.write(f"Frame decode error on frame #{frame_count}: {e}\n")
            sys.stderr.flush()
            continue
        
        # Analyse du visage (émotions et âge)
        try:
            sys.stderr.write(f"Analyzing frame #{frame_count}...\n")
            sys.stderr.flush()
            
            result = DeepFace.analyze(
                frame,
                actions=["emotion", "age"],
                enforce_detection=False,
                prog_bar=False,
                detector_backend='opencv'
            )
            
            sys.stderr.write(f"Analysis result type: {type(result)}\n")
            sys.stderr.flush()
            
            # Si plusieurs visages sont détectés, DeepFace renvoie une liste
            if isinstance(result, list):
                sys.stderr.write(f"Multiple faces detected: {len(result)}\n")
                sys.stderr.flush()
                for idx, res in enumerate(result):
                    try:
                        emotion = res.get('dominant_emotion', res.get('emotion', 'neutral'))
                        if isinstance(emotion, dict):
                            emotion = max(emotion, key=emotion.get)
                        emotions[emotion] = emotions.get(emotion, 0) + 1
                        age = res.get('age')
                        if age is not None:
                            ages.append(age)
                    except Exception as face_err:
                        sys.stderr.write(f"Error processing face {idx}: {face_err}\n")
                        sys.stderr.flush()
            elif isinstance(result, dict):
                sys.stderr.write(f"Single face detected\n")
                sys.stderr.flush()
                emotion = result.get('dominant_emotion', result.get('emotion', 'neutral'))
                if isinstance(emotion, dict):
                    emotion = max(emotion, key=emotion.get)
                emotions[emotion] = emotions.get(emotion, 0) + 1
                age = result.get('age')
                if age is not None:
                    ages.append(age)
            else:
                sys.stderr.write(f"Unexpected result type: {type(result)}\n")
                sys.stderr.flush()
        except Exception as e:
            sys.stderr.write(f"Analysis error on frame #{frame_count}: {type(e).__name__}: {e}\n")
            sys.stderr.flush()
        
        # Output current results every 2 seconds
        current_time = time.time()
        if current_time - last_output_time >= 2:
            # Calculate average age if we have data
            avg_age = sum(ages) / len(ages) if ages else None
            
            output = {
                "emotions": emotions,
                "average_age": avg_age,
                "age_samples": len(ages),
                "timestamp": current_time - start_time
            }
            print(json.dumps(output), flush=True)
            sys.stderr.write(f"Output sent after {frame_count} frames\n")
            sys.stderr.flush()
            last_output_time = current_time
    
    except json.JSONDecodeError:
        # Invalid JSON, skip
        continue
    except Exception as e:
        sys.stderr.write(f"Error processing frame: {e}\n")
        continue