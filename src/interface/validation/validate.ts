async function validate(): Promise<void> {
  console.log('Validation command — not yet implemented.');
  console.log('Will be wired in Step 15.');
}

validate().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
