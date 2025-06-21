import express from 'express';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import * as admin from 'firebase-admin';
import libre from 'libreoffice-convert';
import { onRequest } from 'firebase-functions/v2/https';

admin.initializeApp(
  {
    storageBucket: "adeverinte-app-b8cc1.firebasestorage.app"
  }
);
const storage = admin.storage();

const app = express();
app.use(express.json());

app.post('/signCertificate', async (req, res) => {
  const data = req.body;

  // Validate input
  const signature = data.name;
  if (typeof signature !== 'string' || signature.trim().length === 0) {
    return res.status(400).json({ error: 'Name (signature) must be a non-empty string.' });
  }

  // Generate current date in a visible format
  const date = new Date();
  const dateString = date.toLocaleDateString('ro-RO', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  try {
    console.log('Starting certificate generation process...');
    const bucket = storage.bucket();
    const templatePath = data.templatePath || 'templates/adeverinta_template.docx';
    const outputPath = `signed/output-${Date.now()}.pdf`;

    console.log('Downloading template from Firebase Storage...');
    // Download the template from Firebase Storage
    const [templateBuffer] = await bucket.file(templatePath).download();
    console.log('Template downloaded successfully');

    console.log('Creating DOCX from template...');
    const zip = new PizZip(templateBuffer);
    
    // Create template data with all fields from the request
    const templateData: Record<string, string> = {
      date: dateString,
      signature: signature,
    };

    // Add all fields from the request to templateData
    Object.entries(data).forEach(([key, value]) => {
      if (key !== 'name') { // Skip 'name' as it's already handled as 'signature'
        templateData[key] = value as string;
      }
    });

    // Initialize Docxtemplater with the data
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
    });

    // Set the template data
    doc.setData(templateData);

    console.log('Rendering template with data:', templateData);
    doc.render();
    const docxBuf = doc.getZip().generate({ type: 'nodebuffer' });
    console.log('DOCX generated successfully');

    console.log('Converting DOCX to PDF...');
    // Convert DOCX buffer to PDF using libreoffice-convert
    const pdfBuf: Buffer = await new Promise((resolve, reject) => {
      libre.convert(docxBuf, '.pdf', undefined, (err, done) => {
        if (err) {
          console.error('Error converting to PDF:', err);
          reject(err);
        }
        resolve(done);
      });
    });
    console.log('PDF conversion completed');

    console.log('Uploading PDF to Firebase Storage...');
    // Upload the PDF to Firebase Storage
    const file = bucket.file(outputPath);
    await file.save(pdfBuf, {
      metadata: {
        contentType: 'application/pdf',
      },
    });
    console.log('PDF uploaded successfully');

    // Get the public URL
    const [url] = await file.getSignedUrl({
      action: 'read',
      expires: '03-01-2500', // Far future expiration
    });

    console.log('Process completed successfully');
    return res.json({
      message: 'Certificate generated and signed successfully',
      url: url
    });

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({
      error: 'Failed to generate PDF',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// Add a health check endpoint
app.get('/', (req, res) => {
  res.status(200).send('OK');
});

// Start the server
const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

// Export the function using v2 syntax
export const signCertificate = onRequest({
  region: 'europe-west1',
  memory: '512MiB',
  timeoutSeconds: 540,
  minInstances: 0,
  maxInstances: 10,
  concurrency: 80,
  cpu: 1,
  ingressSettings: 'ALLOW_ALL',
  vpcConnector: 'projects/adeverinte-app-b8cc1/locations/europe-west1/connectors/adeverinte-connector',
  vpcConnectorEgressSettings: 'ALL_TRAFFIC',
  serviceAccount: 'firebase-adminsdk-fbsvc@adeverinte-app-b8cc1.iam.gserviceaccount.com',
}, app);

export default app;
