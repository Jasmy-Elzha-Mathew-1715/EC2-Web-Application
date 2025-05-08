const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const { spawn } = require('child_process');
const { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand, ListBucketsCommand } = require('@aws-sdk/client-s3');
const os = require('os');

require('dotenv').config();

// Create Express app
const app = express();
const port = process.env.PORT || 3000;

// Set Terraform project path
const terraformPath = process.env.TERRAFORM_PATH || 'path';

// Configure S3 client
const s3Region = process.env.AWS_REGION || 'us-east-1';
const s3Client = new S3Client({ region: s3Region });

// In-memory store for active templates
const activeTemplates = {};

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Log all requests
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'Terraform API is running' });
});

// Root endpoint with API documentation
app.get('/', (req, res) => {
  res.json({
    name: 'Terraform API Server',
    version: '1.0.0',
    description: 'API for managing Terraform operations',
    endpoints: [
      { method: 'GET', path: '/health', description: 'Health check endpoint' },
      { method: 'POST', path: '/terraform/init', description: 'Initialize Terraform for a specific template' },
      { method: 'POST', path: '/terraform/apply', description: 'Apply Terraform configuration for a specific template' },
      { method: 'POST', path: '/terraform/destroy', description: 'Destroy Terraform resources for a specific template' },
      { method: 'GET', path: '/terraform/status', description: 'Get status of active templates' },
      { method: 'POST', path: '/terraform/cleanup', description: 'Clean up all temporary resources' }
    ],
    terraformPath: terraformPath
  });
});

// Get active templates status
app.get('/terraform/status', (req, res) => {
  res.json({
    activeTemplates: activeTemplates
  });
});

// Initialize Terraform endpoint
app.post('/terraform/init', async (req, res) => {
  let tempDir;

  try {
    const { template_name } = req.body;
    
    console.log(`[INIT] Starting initialization for template: ${template_name}`);
    
    // Validate input
    if (!template_name) {
      console.log(`[INIT] Validation failed: Missing required fields`);
      return res.status(400).json({
        error: 'template_name is required.'
      });
    }
    
    // Generate a unique S3 bucket name for this operation
    const timestamp = Date.now();
    const bucketName = `terraform-temp-${template_name}-${timestamp}`;
    
    // Create a temporary directory for Terraform operations
    // Using a separate directory outside the terraform project path
    tempDir = path.join(os.tmpdir(), 'terraform_temp', `${template_name}-${timestamp}`);
    console.log(`[INIT] Creating temporary directory: ${tempDir}`);
    
    await fs.mkdir(tempDir, { recursive: true });
    
    // Copy specific Terraform files to the temporary directory
    console.log(`[INIT] Copying Terraform files to temporary directory`);
    
    // List of files to copy - be explicit to avoid recursion
    const filesToCopy = [
      'ec2-web-app.tf',
      'terraform.tfvars',
      '.terraform.lock.hcl'
    ];
    
    for (const file of filesToCopy) {
      const srcPath = path.join(terraformPath, file);
      const destPath = path.join(tempDir, file);
      
      try {
        if (fsSync.existsSync(srcPath)) {
          await fs.copyFile(srcPath, destPath);
          console.log(`[INIT] Copied ${file} to temporary directory`);
        }
      } catch (copyError) {
        console.log(`[INIT] Could not copy ${file}: ${copyError.message}`);
        // Continue with other files
      }
    }
    
    console.log(`[INIT] Generated S3 bucket name: ${bucketName}`);

    // Run terraform init
    console.log(`[INIT] Running terraform init in ${tempDir}`);
    
    const result = await runTerraformCommand('init', [], tempDir);
    
    // Store template information
    activeTemplates[template_name] = {
      bucketName: bucketName,
      tempDir: tempDir,
      status: 'initialized',
      timestamp: timestamp
    };
    
    console.log(`[INIT] Initialization completed successfully for ${template_name}`);
    
    res.status(200).json({
      message: 'Terraform initialized successfully',
      template_name: template_name,
      status: activeTemplates[template_name],
      output: result.output
    });
  } catch (err) {
    console.error(`[INIT] Terraform Initialization Error: ${err.message}`);
    
    if (tempDir) {
      await cleanupTempDir(tempDir);
    }
    
    res.status(500).json({
      error: 'Failed to initialize Terraform',
      details: err.message
    });
  }
});

// Apply Terraform configuration endpoint
app.post('/terraform/apply', async (req, res) => {
  let tempDir;

  try {
    const { template_name } = req.body;
    
    console.log(`[APPLY] Starting apply for template: ${template_name}`);
    
    // Validate input
    if (!template_name) {
      console.log(`[APPLY] Validation failed: Missing required fields`);
      return res.status(400).json({
        error: 'template_name is required.'
      });
    }
    
    // Check if template exists
    if (!activeTemplates[template_name]) {
      console.log(`[APPLY] Template not found: ${template_name}`);
      return res.status(404).json({
        error: `Template ${template_name} not found. Run /terraform/init first.`
      });
    }
    
    const bucketName = activeTemplates[template_name].bucketName;
    tempDir = activeTemplates[template_name].tempDir;
    
    // Verify temp directory exists
    if (!fsSync.existsSync(tempDir)) {
      console.log(`[APPLY] Temporary directory not found: ${tempDir}`);
      
      // Recreate the temporary directory
      console.log(`[APPLY] Recreating temporary directory`);
      await fs.mkdir(tempDir, { recursive: true });
      
      // Copy Terraform files again
      console.log(`[APPLY] Copying Terraform files to temporary directory`);
      
      // List of files to copy
      const filesToCopy = [
        'ec2-web-app.tf',
        'terraform.tfvars',
        '.terraform.lock.hcl'
      ];
      
      for (const file of filesToCopy) {
        const srcPath = path.join(terraformPath, file);
        const destPath = path.join(tempDir, file);
        
        try {
          if (fsSync.existsSync(srcPath)) {
            await fs.copyFile(srcPath, destPath);
            console.log(`[APPLY] Copied ${file} to temporary directory`);
          }
        } catch (copyError) {
          console.log(`[APPLY] Could not copy ${file}: ${copyError.message}`);
        }
      }
      
      // Run terraform init again
      console.log(`[APPLY] Running terraform init in ${tempDir}`);
      await runTerraformCommand('init', [], tempDir);
    }
    
    // Run terraform apply
    console.log(`[APPLY] Running terraform apply in ${tempDir}`);
    const result = await runTerraformCommand('apply', ['-auto-approve'], tempDir);
    
    // Update template status
    activeTemplates[template_name].status = 'applied';
    
    console.log(`[APPLY] Apply completed successfully for ${template_name}`);
    
    res.status(200).json({
      message: 'Terraform applied successfully',
      template_name: template_name,
      status: activeTemplates[template_name],
      output: result.output
    });
  } catch (err) {
    console.error(`[APPLY] Terraform Apply Error: ${err.message}`);
    
    // Update template status if it exists
    if (activeTemplates[req.body.template_name]) {
      activeTemplates[req.body.template_name].status = 'apply_failed';
      activeTemplates[req.body.template_name].error = err.message;
    }
    
    res.status(500).json({
      error: 'Failed to apply Terraform',
      details: err.message
    });
  }
});

// Destroy Terraform resources endpoint
app.post('/terraform/destroy', async (req, res) => {
  let tempDir;

  try {
    const { template_name } = req.body;
    
    console.log(`[DESTROY] Starting destroy for template: ${template_name}`);
    
    // Validate input
    if (!template_name) {
      console.log(`[DESTROY] Validation failed: Missing required fields`);
      return res.status(400).json({
        error: 'template_name is required.'
      });
    }
    
    // Check if template exists
    if (!activeTemplates[template_name]) {
      console.log(`[DESTROY] Template not found: ${template_name}`);
      return res.status(404).json({
        error: `Template ${template_name} not found. Run /terraform/init first.`
      });
    }
    
    const bucketName = activeTemplates[template_name].bucketName;
    tempDir = activeTemplates[template_name].tempDir;
    
    // Verify temp directory exists
    if (!fsSync.existsSync(tempDir)) {
      console.log(`[DESTROY] Temporary directory not found: ${tempDir}`);
      
      // Recreate the temporary directory
      console.log(`[DESTROY] Recreating temporary directory`);
      await fs.mkdir(tempDir, { recursive: true });
      
      // Copy Terraform files again
      console.log(`[DESTROY] Copying Terraform files to temporary directory`);
      
      // List of files to copy
      const filesToCopy = [
        'ec2-web-app.tf',
        'terraform.tfvars',
        '.terraform.lock.hcl'
      ];
      
      for (const file of filesToCopy) {
        const srcPath = path.join(terraformPath, file);
        const destPath = path.join(tempDir, file);
        
        try {
          if (fsSync.existsSync(srcPath)) {
            await fs.copyFile(srcPath, destPath);
            console.log(`[DESTROY] Copied ${file} to temporary directory`);
          }
        } catch (copyError) {
          console.log(`[DESTROY] Could not copy ${file}: ${copyError.message}`);
        }
      }
      
      // Run terraform init again
      console.log(`[DESTROY] Running terraform init in ${tempDir}`);
      await runTerraformCommand('init', [], tempDir);
    }
    
    // Run terraform destroy
    console.log(`[DESTROY] Running terraform destroy in ${tempDir}`);
    const result = await runTerraformCommand('destroy', ['-auto-approve'], tempDir);
    
    // Clean up any created S3 buckets
    try {
      console.log(`[DESTROY] Attempting to clean up S3 bucket: ${bucketName}`);
      await cleanupS3Bucket(bucketName);
    } catch (s3Error) {
      console.error(`[DESTROY] Error cleaning up S3 bucket: ${s3Error.message}`);
    }
    
    // Clean up temporary directory
    await cleanupTempDir(tempDir);
    
    // Remove template from active templates
    delete activeTemplates[template_name];
    
    console.log(`[DESTROY] Destroy completed successfully for ${template_name}`);
    
    res.status(200).json({
      message: 'Terraform resources destroyed successfully',
      template_name: template_name,
      output: result.output
    });
  } catch (err) {
    console.error(`[DESTROY] Terraform Destroy Error: ${err.message}`);
    
    // Update template status if it exists
    if (activeTemplates[req.body.template_name]) {
      activeTemplates[req.body.template_name].status = 'destroy_failed';
      activeTemplates[req.body.template_name].error = err.message;
    }
    
    res.status(500).json({
      error: 'Failed to destroy Terraform resources',
      details: err.message
    });
  }
});

// Clean up endpoint
app.post('/terraform/cleanup', async (req, res) => {
  try {
    console.log('[CLEANUP] Starting cleanup of all temporary resources');
    
    // Find and clean up all temporary buckets
    await cleanupAllTempBuckets();
    
    // Clean up all temporary directories
    for (const templateName in activeTemplates) {
      const tempDir = activeTemplates[templateName].tempDir;
      if (tempDir && fsSync.existsSync(tempDir)) {
        await cleanupTempDir(tempDir);
      }
    }
    
    // Clear active templates
    Object.keys(activeTemplates).forEach(key => delete activeTemplates[key]);
    
    console.log('[CLEANUP] Cleanup completed successfully');
    
    res.status(200).json({
      message: 'All temporary resources cleaned up successfully'
    });
  } catch (err) {
    console.error(`[CLEANUP] Cleanup Error: ${err.message}`);
    
    res.status(500).json({
      error: 'Failed to clean up temporary resources',
      details: err.message
    });
  }
});

// Utility function to execute Terraform commands
function runTerraformCommand(command, args = [], cwd) {
  return new Promise((resolve, reject) => {
    console.log(`Running terraform ${command} ${args.join(' ')} in ${cwd}`);
    
    const terraform = spawn('terraform', [command, ...args], {
      cwd,
      shell: true
    });
    
    let output = '';
    let errorOutput = '';
    
    terraform.stdout.on('data', (data) => {
      const chunk = data.toString();
      output += chunk;
      console.log(chunk);
    });
    
    terraform.stderr.on('data', (data) => {
      const chunk = data.toString();
      errorOutput += chunk;
      console.error(chunk);
    });
    
    terraform.on('close', (code) => {
      if (code !== 0) {
        reject({
          success: false,
          command: `terraform ${command}`,
          code,
          output,
          error: errorOutput
        });
      } else {
        resolve({
          success: true,
          command: `terraform ${command}`,
          output
        });
      }
    });
    
    terraform.on('error', (err) => {
      reject({
        success: false,
        command: `terraform ${command}`,
        error: err.message
      });
    });
  });
}

// Utility function to clean up temporary directories
async function cleanupTempDir(tempDir) {
  try {
    await fs.rm(tempDir, { recursive: true, force: true });
    console.log(`[CLEANUP] Cleaned up temporary directory: ${tempDir}`);
    return true;
  } catch (err) {
    console.error(`[CLEANUP] Error cleaning up temporary directory: ${err.message}`);
    return false;
  }
}

// Utility function to clean up an S3 bucket
async function cleanupS3Bucket(bucketName) {
  try {
    if (!bucketName || !bucketName.startsWith('terraform-temp-')) {
      console.log(`[CLEANUP] Skipping bucket ${bucketName} as it doesn't match the naming pattern`);
      return false;
    }
    
    // List all objects in the bucket
    const listCommand = new ListObjectsV2Command({
      Bucket: bucketName
    });
    
    const { Contents } = await s3Client.send(listCommand);
    
    if (Contents && Contents.length > 0) {
      // Delete all objects in the bucket
      for (const obj of Contents) {
        const deleteCommand = new DeleteObjectCommand({
          Bucket: bucketName,
          Key: obj.Key
        });
        
        await s3Client.send(deleteCommand);
        console.log(`[CLEANUP] Deleted object ${obj.Key} from bucket ${bucketName}`);
      }
    }
    
    // Delete the bucket itself
    const deleteBucketCommand = new DeleteBucketCommand({
      Bucket: bucketName
    });
    
    await s3Client.send(deleteBucketCommand);
    console.log(`[CLEANUP] Deleted bucket ${bucketName}`);
    return true;
  } catch (err) {
    console.error(`[CLEANUP] Error cleaning up bucket ${bucketName}: ${err.message}`);
    return false;
  }
}

// Utility function to find and clean up all temporary buckets
async function cleanupAllTempBuckets() {
  try {
    // List all buckets
    const listBucketsCommand = new ListBucketsCommand({});
    
    const { Buckets } = await s3Client.send(listBucketsCommand);
    
    if (!Buckets || Buckets.length === 0) {
      console.log('[CLEANUP] No buckets found');
      return;
    }
    
    // Filter buckets by naming pattern
    const tempBuckets = Buckets.filter(bucket => 
      bucket.Name.startsWith('terraform-temp-')
    );
    
    console.log(`[CLEANUP] Found ${tempBuckets.length} temporary buckets to clean up`);
    
    // Clean up each bucket
    for (const bucket of tempBuckets) {
      await cleanupS3Bucket(bucket.Name);
    }
  } catch (err) {
    console.error(`[CLEANUP] Finding and cleaning up temporary buckets: ${err.message}`);
    throw err;
  }
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message
  });
});

// Start the server
app.listen(port, () => {
  console.log(`Terraform API server listening at http://localhost:${port}`);
  console.log(`Using Terraform project path: ${terraformPath}`);
  console.log(`Using AWS region: ${s3Region}`);
  console.log(`Using temporary directory: ${os.tmpdir()}/terraform_temp`);
});