function getDataTypeRange(model, fieldName) {
  const field = model.rawAttributes[fieldName];
  if (!field) {
    throw new Error(`Field ${fieldName} does not exist in the model`);
  }

  const dataType = field.type.key;

  switch (dataType) {
    case 'INTEGER': // Standard 4-byte integer
      return { min: -2147483648, max: 2147483647 };
    case 'BIGINT': // 8-byte integer
      return { min: -9223372036854775808, max: 9223372036854775807n };
    case 'SMALLINT': // 2-byte integer
      return { min: -32768, max: 32767 };
    default:
      throw new Error(`Range for data type ${dataType} is not defined`);
  }
}

module.exports = {
  getDataTypeRange,
};
