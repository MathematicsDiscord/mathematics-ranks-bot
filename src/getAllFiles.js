const fs = require('fs');
const path = require('path');

const getAllFiles = (dir, extension) => {
    if (!dir || typeof dir !== 'string') {
        console.error('Invalid directory path:', dir);
        return [];
    }

    try {
        const files = fs.readdirSync(dir, {
            withFileTypes: true,
        });
        let jsFiles = [];

        for (const file of files) {
            if (file.isDirectory()) {
                jsFiles = [...jsFiles, ...getAllFiles(path.join(dir, file.name), extension)];
            } else if (
                file.name.endsWith(extension || '.js') &&
                !file.name.startsWith('!')
            ) {
                let fileName = file.name.replace(/\\/g, '/').split('/');
                fileName = fileName[fileName.length - 1];
                fileName = fileName.split('.')[0].toLowerCase();

                jsFiles.push([path.join(dir, file.name), fileName]);
            }
        }

        return jsFiles;
    } catch (error) {
        console.error(`Error reading directory ${dir}:`, error);
        return [];
    }
}

module.exports = getAllFiles;