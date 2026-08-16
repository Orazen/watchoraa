// COCO 80-class names, in the standard index order used by YOLOv8/YOLO11 COCO-trained
// checkpoints (including the stock model exported to public/models/yolov8n.onnx).
export const COCO_CLASSES = [
  'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck', 'boat',
  'traffic light', 'fire hydrant', 'stop sign', 'parking meter', 'bench', 'bird', 'cat',
  'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe', 'backpack',
  'umbrella', 'handbag', 'tie', 'suitcase', 'frisbee', 'skis', 'snowboard', 'sports ball',
  'kite', 'baseball bat', 'baseball glove', 'skateboard', 'surfboard', 'tennis racket',
  'bottle', 'wine glass', 'cup', 'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple',
  'sandwich', 'orange', 'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake', 'chair',
  'couch', 'potted plant', 'bed', 'dining table', 'toilet', 'tv', 'laptop', 'mouse',
  'remote', 'keyboard', 'cell phone', 'microwave', 'oven', 'toaster', 'sink', 'refrigerator',
  'book', 'clock', 'vase', 'scissors', 'teddy bear', 'hair drier', 'toothbrush',
] as const;

// Classes that are always relevant to a blind pedestrian's immediate hazard awareness.
// Notable known gap (documented in docs/yolo-ocr-slam-plan.md #2.1): COCO has no
// "stairs" / "curb" / "step" class. This is a real limitation of a stock COCO model,
// not something fixable by prompt tuning here.
export const HAZARD_CLASSES = new Set<string>([
  'person', 'bicycle', 'car', 'motorcycle', 'bus', 'train', 'truck', 'boat',
  'traffic light', 'fire hydrant', 'stop sign', 'bench', 'dog', 'cat',
  'chair', 'couch', 'bed', 'dining table', 'suitcase', 'skateboard',
]);

// Classes that matter for orientation but are not urgent hazards — surfaced with the
// "clear / informational" haptic pattern rather than the hazard pattern.
export const LANDMARK_CLASSES = new Set<string>([
  'potted plant', 'tv', 'clock', 'refrigerator', 'sink', 'toilet', 'oven',
]);
