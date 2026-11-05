function invalid_request(res, message) {
  return res.status(422).json({ message });
}

function database_error(res, error) {
  console.error(error);
  return res.status(500).json({ message: "Database request failed." });
}

export { invalid_request, database_error };
