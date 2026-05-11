// Rectangular frame guide that fills the screen with tight margins.
// Fit the subject inside the dashed rectangle.
export default function CameraOutline() {
  return (
    <svg
      viewBox="0 0 400 220"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      className="w-full h-full"
      preserveAspectRatio="none"
    >
      <rect
        x="4"
        y="4"
        width="392"
        height="212"
        rx="10"
        ry="10"
        strokeDasharray="10 6"
      />
    </svg>
  )
}
