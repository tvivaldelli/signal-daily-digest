// Simple test component
export default function AppTest() {
  return (
    <div style={{ padding: '20px', fontFamily: 'Arial' }}>
      <h1>React is Working!</h1>
      <p>If you see this, React is rendering correctly.</p>
      <p>Current time: {new Date().toLocaleTimeString()}</p>
    </div>
  );
}
