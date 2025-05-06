# Web Application AWS Infrastructure

This repository contains Terraform code to provision and manage AWS infrastructure for a web application with frontend and backend components.

## Architecture

The infrastructure includes:

- S3 bucket for artifacts storage
- Application Load Balancer
- Target groups for frontend and backend services
- RDS database with subnet group and parameter configurations
- CloudWatch logging

## Prerequisites

- AWS CLI configured with appropriate credentials
- Terraform installed (v1.0.0+)
- Basic knowledge of AWS services

## Usage

### Initialize Terraform

```bash
terraform init
```

### Plan Changes

```bash
terraform plan
```

### Apply Changes

```bash
terraform apply
```

### Destroy Infrastructure

```bash
terraform destroy
```

## Environment Variables

Set the following environment variables or use a `.tfvars` file:

```
TF_VAR_environment=dev
TF_VAR_region=us-east-1
TF_VAR_app_name=web-app
```

## Resource Naming Convention

Resources follow the naming convention: `{app_name}-{environment}-{resource_type}`

Example: `web-app-dev-alb`

## Important Notes

- Always review the plan before applying changes
- Use appropriate IAM permissions
- Backup your terraform state file regularly
- Consider using remote state with S3 and DynamoDB locking

## Troubleshooting

If resources already exist and you get "already exists" errors:
1. Import existing resources into your state file, or
2. Delete them manually via AWS Console or CLI before applying

