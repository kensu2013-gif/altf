import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function walk(dir, done) {
    let results = [];
    fs.readdir(dir, function (err, list) {
        if (err) return done(err);
        let pending = list.length;
        if (!pending) return done(null, results);
        list.forEach(function (file) {
            file = path.resolve(dir, file);
            fs.stat(file, function (err, stat) {
                if (stat && stat.isDirectory()) {
                    walk(file, function (err, res) {
                        results = results.concat(res);
                        if (!--pending) done(null, results);
                    });
                } else {
                    if (file.endsWith('.ts') || file.endsWith('.tsx')) {
                        results.push(file);
                    }
                    if (!--pending) done(null, results);
                }
            });
        });
    });
}

const targetDir = path.join(__dirname, 'src');

walk(targetDir, (err, files) => {
    if (err) throw err;
    let replacedCount = 0;
    files.forEach(f => {
        let content = fs.readFileSync(f, 'utf8');

        // Match standard fetch
        let newContent = content.replace(/fetch\(\s*['"]\/api\//g, "fetch(import.meta.env.VITE_API_URL + '/api/");

        // Match template literal fetch
        newContent = newContent.replace(/fetch\(\s*\`\/api\//g, "fetch(`${import.meta.env.VITE_API_URL}/api/");

        if (content !== newContent) {
            fs.writeFileSync(f, newContent);
            replacedCount++;
            console.log('Modified', f);
        }
    });
    console.log('Total modified:', replacedCount);
});
