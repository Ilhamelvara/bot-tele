const { execFile } = require("child_process");
const path = require("path");
const fs = require("fs");

function getLibreOfficePath() {
    const candidates = [
        "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.com",
        "C:\\Program Files\\LibreOffice\\program\\soffice.com",
        "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
        "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return null;
}

function pdfToWord(inputPath, outputDir) {
    return new Promise((resolve, reject) => {
        const sofficePath = getLibreOfficePath();

        if (!sofficePath) {
            return reject(
                new Error("LibreOffice tidak ditemukan.")
            );
        }

        // Profile LibreOffice khusus untuk proses bot
        const profileDir = path.join(
            outputDir,
            `lo-profile-${Date.now()}`
        );

        fs.mkdirSync(profileDir, {
            recursive: true,
        });

        const profileUrl =
            `file:///${profileDir.replace(/\\/g, "/")}`;

        const args = [
            "--headless",
            "--invisible",
            "--nodefault",
            "--nofirststartwizard",
            `-env:UserInstallation=${profileUrl}`,
            "--infilter=writer_pdf_import",
            "--convert-to",
            "docx",
            "--outdir",
            outputDir,
            inputPath,
        ];

        console.log("🔄 Menjalankan LibreOffice...");
        console.log("Command:", sofficePath, args.join(" "));

        execFile(
            sofficePath,
            args,
            {
                windowsHide: true,
            },
            (error, stdout, stderr) => {

                // Hapus profile sementara
                try {
                    if (fs.existsSync(profileDir)) {
                        fs.rmSync(profileDir, {
                            recursive: true,
                            force: true,
                        });
                    }
                } catch (cleanupError) {
                    console.error(
                        "Gagal menghapus profile:",
                        cleanupError
                    );
                }

                console.log(
                    "LibreOffice stdout:",
                    stdout
                );

                console.log(
                    "LibreOffice stderr:",
                    stderr
                );

                if (error) {
                    return reject(error);
                }

                const fileName = path.basename(
                    inputPath,
                    path.extname(inputPath)
                );

                const outputPath = path.join(
                    outputDir,
                    `${fileName}.docx`
                );

                if (!fs.existsSync(outputPath)) {
                    return reject(
                        new Error(
                            "File DOCX hasil konversi tidak ditemukan."
                        )
                    );
                }

                resolve(outputPath);
            }
        );
    });
}

module.exports = pdfToWord;