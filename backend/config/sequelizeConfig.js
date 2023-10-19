require('dotenv').config();
//Load all present .env.* files
for (const env of ['', '.development', '.production', '.local']) {
    require('dotenv').config({ path: `.env${env}` });
}

module.exports = {
    development: {
        username: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        host: process.env.DB_HOST || 'localhost',
        dialect: 'postgres',
        models: [__dirname + '/../models'],
        migrationStorageTableName: 'sequelize_meta',
        migrationStoragePath: './migrations'
    },
};
