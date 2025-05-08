# Terraform EC2 Web Application Deployment

This project provides an infrastructure as code (IaC) solution for deploying a web application on AWS EC2 instances with a supporting API server to manage Terraform operations. The infrastructure includes frontend and backend EC2 instances, an RDS PostgreSQL database, load balancers, networking components, and all necessary security configurations.

## Prerequisites

### Required Software

1. **Node.js** (v14.x or higher)
2. **Terraform** (v1.0.0 or higher)
3. **AWS CLI** (configured with appropriate credentials)

### AWS Account Setup

1. An AWS account with appropriate permissions
2. AWS credentials configured locally (`~/.aws/credentials`)

## Installation

### 1. Clone the Repository

```bash
git clone <your-repository-url>
cd TERRAFORM_SCRIPTS
```

### 2. Install Node.js Dependencies

```bash
npm init -y
npm install express body-parser cors @aws-sdk/client-s3
```

### 3. Configure AWS Credentials

Ensure your AWS credentials are properly configured:

```bash
aws configure
```

### 4. Update Configuration Files

#### terraform.tfvars

Create or update your `terraform.tfvars` file with your specific configurations:

```hcl
aws_region        = "us-east-1"      # Your preferred AWS region
project_name      = "your-web-app"   # Your project name
org_name          = "YourCompany"    # Your organization name
app_name          = "EC2WebApp"      # Application name
```

#### Environment Variables for API Server

Consider creating a `.env` file for API server configuration:

```
PORT=3000
TERRAFORM_PATH=/path/to/your/TERRAFORM_SCRIPTS
AWS_REGION=us-east-1
```

## Required Code Changes

### 1. Update AMI IDs

In `ec2-web-app.tf`, ensure the AMI IDs are current and valid for your region:

```hcl
variable "backend_ami_id" {
  type    = string
  default = "ami-0f88e80871fd81e91" # Update with valid AMI ID
}

variable "frontend_ami_id" {
  type    = string
  default = "ami-0f88e80871fd81e91" # Update with valid AMI ID
}
```

### 2. Update API Server Path

In `app.js`, modify the `terraformPath` variable to match your environment:

```javascript
// Change this line
const terraformPath = process.env.TERRAFORM_PATH || 'path';

// To use an environment variable or relative path
const terraformPath = process.env.TERRAFORM_PATH || path.join(__dirname);
```

### 3. Fix S3 Client Dependencies

The code uses `DeleteBucketCommand` but doesn't import it. Add this to the imports in `app.js`:

```javascript
const { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand, ListBucketsCommand, DeleteBucketCommand } = require('@aws-sdk/client-s3');
```

## Usage

### Starting the API Server

```bash
node app.js
```

The API server will start at http://localhost:3000

### API Endpoints

- **GET /health**: Health check endpoint
- **GET /**: API documentation
- **GET /terraform/status**: Get status of active templates
- **POST /terraform/init**: Initialize Terraform for a template
  ```json
  { "template_name": "webapp" }
  ```
- **POST /terraform/apply**: Apply Terraform configuration
  ```json
  { "template_name": "webapp" }
  ```
- **POST /terraform/destroy**: Destroy Terraform resources
  ```json
  { "template_name": "webapp" }
  ```
- **POST /terraform/cleanup**: Clean up all temporary resources

### Running Terraform Directly

You can also run Terraform commands directly:

```bash
# Initialize Terraform
terraform init

# Plan the infrastructure changes
terraform plan

# Apply the infrastructure
terraform apply

# Destroy the infrastructure when no longer needed
terraform destroy
```

## Infrastructure Components

This Terraform configuration deploys:

1. **VPC with public and private subnets**
2. **EC2 Instances**:
   - Frontend instance (for web UI)
   - Backend instance (for API)
3. **Application Load Balancer** with routing rules
4. **RDS PostgreSQL Database** in private subnet
5. **Security Groups** with appropriate access rules
6. **S3 Buckets** for Terraform state and artifacts
7. **CloudWatch** logging and monitoring

## Security Features

- Database credentials stored in AWS Secrets Manager
- Private subnets for database
- Security groups limit access to necessary ports
- NAT Gateway for private subnet internet access

## Outputs

After successful deployment, you'll get:
- Application URL
- API URL
- DB Endpoint
- EC2 Instance IDs
- S3 Bucket names

## Troubleshooting

### Common Issues

1. **Terraform initialization fails**:
   - Ensure AWS credentials are properly configured
   - Check internet connectivity for provider downloads

2. **API server fails to start**:
   - Verify Node.js is installed and version is compatible
   - Check if required port (3000) is available

3. **AWS resource creation fails**:
   - Verify AWS account has appropriate permissions
   - Check if resource limits are reached in your AWS account
   - Ensure AMI IDs are valid for your region

